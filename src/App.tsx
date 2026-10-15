import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, Company, Contact, CrmAnalytics, CrmData, CrmNote, CrmTask, Job, Opportunity } from "./types";
import { emptyWorkspace } from "./data/empty";
import { getAnalytics, getWorkspace, isMockAuthEnabled, saveWorkspace } from "./data/api";
import OutreachPage, { OutreachConversationsDialog, OutreachThreadDialog } from "./outreach/OutreachPage";
import EmailProvidersSettings from "./outreach/EmailProvidersSettings";
import GroqDraftSettings from "./outreach/GroqDraftSettings";
import { getCalendarMeetings, getOutreachMessages } from "./data/outreach";
import type { CalendarMeeting, OutreachMessage } from "./types/outreach";
import MeetingsPage from "./outreach/MeetingsPage";

type Kind = "contact" | "company" | "job" | "opportunity" | "task";
type Page = "Outreach" | "Dashboard" | "Contacts" | "Companies" | "Jobs" | "Opportunities" | "Tasks & Follow-ups" | "Meetings" | "Activities" | "Settings";
type Field = { key: string; label: string; type?: string; options?: string[]; placeholder?: string; required?: boolean; wide?: boolean };
type Column = { key: string; label: string; render?: (record: any) => React.ReactNode };

const nav: { page: Page; icon: string; group?: string }[] = [
  { page: "Outreach", icon: "mail" },
  { page: "Dashboard", icon: "grid" },
  { page: "Contacts", icon: "users", group: "WORKSPACE" },
  { page: "Companies", icon: "building" },
  { page: "Jobs", icon: "briefcase" },
  { page: "Opportunities", icon: "target" },
  { page: "Tasks & Follow-ups", icon: "check" },
  { page: "Meetings", icon: "calendar", group: "INSIGHTS" },
  { page: "Activities", icon: "activity", group: "INSIGHTS" },
  { page: "Settings", icon: "settings", group: "PREFERENCES" },
];
const today = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const newId = (prefix: string) => prefix + "-" + Math.random().toString(36).slice(2, 9);
const websiteHref = (value: string) => {
  const url = value.trim();
  if (!url) return "";
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(url) ? url : "https://" + url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
};
const normalizeCsvHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
      } else if (!field.trim()) {
        field = "";
        quoted = true;
      } else {
        field += character;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      row.push(field.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
};
const normalizeCompanyName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const fmtDate = (date?: string) => {
  if (!date) return "—";
  const parsed = new Date(date.length === 10 ? date + "T12:00:00" : date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
};
const fmtTime = (date?: string) => {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(parsed);
};
const fullName = (c?: Contact) => c ? c.firstName + " " + c.lastName : "Unlinked contact";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const kindLabel: Record<Kind, string> = { contact: "Contact", company: "Company", job: "Job", opportunity: "Opportunity", task: "Task" };
const pageKind: Partial<Record<Page, Kind>> = { Contacts: "contact", Companies: "company", Jobs: "job", Opportunities: "opportunity" };
const plural: Record<Kind, keyof CrmData> = { contact: "contacts", company: "companies", job: "jobs", opportunity: "opportunities", task: "tasks" };

const iconPaths: Record<string, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  users: "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm3 3a4 4 0 0 0 0-7m2 17v-2a4 4 0 0 0-3-3.87",
  building: "M3 21h18M5 21V5l7-3 7 3v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4",
  briefcase: "M3 7h18v13H3zM8 7V4h8v3M3 12h18M10 12v2h4v-2",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-5 7-7",
  check: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7.7 7.7 0 0 0-.1-1.2l1.5-1.2-1.5-2.6-1.8.6a7.6 7.6 0 0 0-2.1-1.2L15.1 4h-3l-.4 2.4a7.6 7.6 0 0 0-2.1 1.2l-1.8-.6-1.5 2.6 1.5 1.2a7.7 7.7 0 0 0 0 2.4l-1.5 1.2 1.5 2.6 1.8-.6a7.6 7.6 0 0 0 2.1 1.2l.4 2.4h3l.4-2.4a7.6 7.6 0 0 0 2.1-1.2l1.8.6 1.5-2.6-1.5-1.2c.1-.4.2-.8.2-1.2Z",
  search: "m21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
  plus: "M12 5v14m-7-7h14",
  chevron: "m9 18 6-6-6-6",
  down: "m6 9 6 6 6-6",
  close: "M18 6 6 18M6 6l12 12",
  arrow: "M7 17 17 7M7 7h10v10",
  clock: "M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  filter: "M4 6h16M7 12h10m-7 6h4",
  board: "M3 4h18v16H3zM9 4v16m6-16v16",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5-5 5 5m-5-5v12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3",
  note: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h8",
  mail: "M4 5h16v14H4zM4 7l8 6 8-6",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.4 2.7a2 2 0 0 1-.6 1.7L7.5 9.5a16 16 0 0 0 6 6l1.4-1.4a2 2 0 0 1 1.7-.6l2.7.4a2 2 0 0 1 1.7 2Z",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
  spark: "m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Zm7 12 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z",
  chevronDown: "m6 9 6 6 6-6",
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name] || iconPaths.spark} /></svg>;
}

function App({ userName, userEmail, onSignOut, onUpdateUserName }: { userName: string; userEmail: string; onSignOut: () => void; onUpdateUserName: (name: string) => Promise<void> }) {
  const [data, setData] = useState<CrmData>(emptyWorkspace);
  const [metrics, setMetrics] = useState<CrmAnalytics>({ date: today(), totalContacts: 0, totalCompanies: 0, activeJobs: 0, openOpportunities: 0, needsAttention: 0, tasksDueToday: 0, overdueFollowUps: 0, wonLast30Days: 0, totalWon: 0, totalLost: 0, openOpportunityValue: 0, pipeline: [] });
  const [dataReady, setDataReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [syncState, setSyncState] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [page, setPage] = useState<Page>("Outreach");
  const [query, setQuery] = useState("");
  const [localQuery, setLocalQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [sortKey, setSortKey] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [pageNo, setPageNo] = useState(1);
  const [dialog, setDialog] = useState<{ kind: Kind; record?: any } | null>(null);
  const [detail, setDetail] = useState<{ kind: Kind; id: string } | null>(null);
  const [toast, setToast] = useState("");
  const [view, setView] = useState<"table" | "board">("table");
  const [taskTab, setTaskTab] = useState("My Tasks");
  const [searchFocus, setSearchFocus] = useState(false);
  const [menu, setMenu] = useState<"profile" | "notifications" | null>(null);
  const [noteText, setNoteText] = useState("");
  const [pipelineText, setPipelineText] = useState(data.pipelineStages.join("\n"));
  const [jobStatusText, setJobStatusText] = useState(data.jobStatuses.join("\n"));
  const [orgName, setOrgName] = useState(data.organization);
  const [displayName, setDisplayName] = useState(userName);
  const [profileName, setProfileName] = useState(userName);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [dragged, setDragged] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setDataReady(false);
    setLoadError("");
    setSyncState("loading");
    const load = async () => {
      try {
        const [workspace, analytics] = await Promise.all([getWorkspace(), getAnalytics(today())]);
        if (!alive) return;
        setData(workspace);
        setMetrics(analytics);
        setPipelineText(workspace.pipelineStages.join("\n"));
        setJobStatusText(workspace.jobStatuses.join("\n"));
        setOrgName(workspace.organization);
        setDataReady(true);
        setSyncState("saved");
      } catch (error: unknown) {
        if (!alive) return;
        setLoadError(error instanceof Error ? error.message : "Could not load your CRM workspace.");
        setSyncState("error");
      }
    };
    void load();
    return () => { alive = false; };
  }, [loadAttempt]);
  useEffect(() => {
    if (!dataReady) return;
    let alive = true;
    setSyncState("saving");
    const timer = window.setTimeout(() => {
      saveWorkspace(data).then(async () => {
        try {
          const nextMetrics = await getAnalytics(today());
          if (alive) setMetrics(nextMetrics);
        } catch (error: unknown) {
          if (alive) setToast(error instanceof Error ? "Analytics refresh failed: " + error.message : "Analytics refresh failed.");
        }
        if (alive) setSyncState("saved");
      }).catch((error: unknown) => {
        if (alive) {
          setSyncState("error");
          setToast(error instanceof Error ? "Sync failed: " + error.message : "Sync failed. Check your connection and try again.");
        }
      });
    }, 350);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [data, dataReady]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => { setLocalQuery(""); setFilter("All"); setPageNo(1); }, [page]);

  const notify = (message: string) => setToast(message);
  useEffect(() => {
    setDisplayName(userName);
    setProfileName(userName);
  }, [userName]);

  const saveProfileName = async () => {
    const name = profileName.trim();
    if (!name) {
      setProfileError("Enter a name before saving.");
      return;
    }
    setProfileBusy(true);
    setProfileError("");
    setProfileMessage("");
    try {
      await onUpdateUserName(name);
      setDisplayName(name);
      setProfileName(name);
      setProfileMessage("Your name has been updated.");
    } catch (reason: unknown) {
      setProfileError(reason instanceof Error ? reason.message : "Could not update your name.");
    } finally {
      setProfileBusy(false);
    }
  };
  const mutate = (fn: (copy: CrmData) => void) => setData((old) => {
    const copy = structuredClone(old);
    fn(copy);
    return copy;
  });
  const addActivity = (copy: CrmData, type: string, title: string, detailText: string, recordType: string, recordId: string) => {
    copy.activities.unshift({ id: newId("ac"), type, title, detail: detailText, recordType, recordId, user: "You", createdAt: new Date().toISOString() });
  };
  const getRecord = (kind: Kind, id: string): any => (data[plural[kind]] as any[]).find((record) => record.id === id);
  const companyName = (id?: string) => data.companies.find((company) => company.id === id)?.name || "No company";
  const getRecordLabel = (kind: Kind, id: string) => {
    const item = getRecord(kind, id);
    if (!item) return "Removed record";
    if (kind === "contact") return fullName(item);
    if (kind === "company") return item.name;
    if (kind === "job") return item.title;
    if (kind === "opportunity") return item.title;
    return item.title;
  };
  const openDetail = (kind: Kind, id: string) => { setDetail({ kind, id }); setDialog(null); setMenu(null); setNoteText(""); };
  const openNew = (kind: Kind) => setDialog({ kind });
  const activeDetail = detail ? getRecord(detail.kind, detail.id) : null;
  const unreadTasks = data.tasks.filter((task) => task.status !== "Completed" && task.status !== "Cancelled");
  const todayTasks = data.tasks.filter((task) => task.dueDate.slice(0, 10) === today() && task.status !== "Completed" && task.status !== "Cancelled");

  const persistRecord = (kind: Kind, form: Record<string, string>, existing?: any) => {
    const listName = plural[kind] as "contacts" | "companies" | "jobs" | "opportunities" | "tasks";
    const id = existing?.id || newId(kind.slice(0, 2));
    const date = today();
    let duplicate = "";
    if (kind === "contact" && form.email) {
      duplicate = data.contacts.some((c) => c.id !== existing?.id && c.email.trim().toLowerCase() === form.email.trim().toLowerCase()) ? "A contact with this email already exists." : "";
    }
    if (kind === "company" && form.name) {
      duplicate = data.companies.some((c) => c.id !== existing?.id && c.name.trim().toLowerCase() === form.name.trim().toLowerCase()) ? "A company with this name already exists." : "";
    }
    if (kind === "job" && form.referenceId) {
      duplicate = data.jobs.some((job) => job.id !== existing?.id && job.referenceId.trim().toLowerCase() === form.referenceId.trim().toLowerCase()) ? "That job reference is already in use." : "";
    }
    if (duplicate) { notify(duplicate); return false; }

    mutate((copy) => {
      const recordForm = { ...form };
      if (kind === "contact") {
        const companyNameInput = (recordForm.companyName || "").trim();
        delete recordForm.companyName;
        if (companyNameInput) {
          const matchedCompany = copy.companies.find((company) => company.name.trim().toLowerCase() === companyNameInput.toLowerCase());
          if (matchedCompany) recordForm.companyId = matchedCompany.id;
          else {
            const companyId = newId("co");
            copy.companies.unshift({
              id: companyId, name: companyNameInput, website: "", industry: "", size: "", location: "",
              description: "", status: "Prospect", tags: "", notes: "", createdAt: date, updatedAt: date,
            });
            recordForm.companyId = companyId;
            addActivity(copy, "company", "Company created", companyNameInput, "company", companyId);
          }
        } else recordForm.companyId = "";
      }
      const body: any = { ...existing, ...recordForm, id, updatedAt: date, createdAt: existing?.createdAt || date };
      if (kind === "contact") {
        body.tags = form.tags || "";
        if (body.status === "Inactive") body.archived = existing?.archived || false;
      }
      if (kind === "opportunity") {
        body.stageHistory = existing?.stageHistory || [{ stage: body.stage, date }];
        if (existing && existing.stage !== body.stage) {
          body.stageHistory = [...body.stageHistory, { stage: body.stage, date }];
          addActivity(copy, "stage", "Opportunity moved to " + body.stage, body.title + " · " + companyName(body.companyId), "opportunity", id);
        }
        if (body.stage === "Won" && existing?.stage !== "Won") addActivity(copy, "won", "Opportunity marked Won", body.title + " · " + companyName(body.companyId), "opportunity", id);
        if (body.stage === "Lost" && existing?.stage !== "Lost") addActivity(copy, "lost", "Opportunity marked Lost", body.title + (body.lossReason ? " · " + body.lossReason : ""), "opportunity", id);
      }
      if (kind === "job" && body.status === "Completed" && !body.completionDate) body.completionDate = date;
      if (kind === "task" && body.status === "Completed" && !body.completedAt) body.completedAt = date;
      const list = copy[listName] as any[];
      const index = list.findIndex((record) => record.id === id);
      if (index >= 0) list[index] = body;
      else list.unshift(body);
      const labels: Record<Kind, string> = {
        contact: fullName(body),
        company: body.name,
        job: body.title,
        opportunity: body.title,
        task: body.title,
      };
      if (kind !== "opportunity") addActivity(copy, existing ? "update" : kind, (existing ? kindLabel[kind] + " updated" : kindLabel[kind] + " created"), labels[kind], kind, id);
      if (kind === "task" && body.status === "Completed" && existing?.status !== "Completed") addActivity(copy, "task", "Task completed", body.title, "task", id);
    });
    setDialog(null);
    setDetail(null);
    notify(existing ? kindLabel[kind] + " updated" : kindLabel[kind] + " created");
    return true;
  };

  const updateTaskStatus = (task: CrmTask, status: string) => {
    mutate((copy) => {
      const found = copy.tasks.find((item) => item.id === task.id);
      if (!found) return;
      found.status = status as CrmTask["status"];
      found.completedAt = status === "Completed" ? today() : "";
      found.updatedAt = today();
      addActivity(copy, "task", status === "Completed" ? "Task completed" : "Task updated", found.title, "task", found.id);
    });
    notify(status === "Completed" ? "Task completed" : "Task updated");
  };

  const archiveRecord = (kind: Kind, record: any) => {
    if (!window.confirm("Archive this " + kindLabel[kind].toLowerCase() + "? You can find archived records with the Archived filter.")) return;
    mutate((copy) => {
      const item = (copy[plural[kind]] as any[]).find((row) => row.id === record.id);
      if (item) item.archived = true;
      addActivity(copy, "archive", kindLabel[kind] + " archived", getRecordLabel(kind, record.id), kind, record.id);
    });
    setDetail(null);
    notify(kindLabel[kind] + " archived");
  };

  const restoreRecord = (kind: Kind, record: any) => {
    mutate((copy) => {
      const item = (copy[plural[kind]] as any[]).find((row) => row.id === record.id);
      if (!item) return;
      item.archived = false;
      addActivity(copy, "restore", kindLabel[kind] + " restored", getRecordLabel(kind, record.id), kind, record.id);
    });
    setDetail(null);
    if (filter === "Archived") setFilter("All");
    notify(kindLabel[kind] + " restored from archive");
  };

  const changeOpportunityStage = (opportunity: Opportunity, stage: string) => {
    if (stage === opportunity.stage) return;
    let reason = opportunity.lossReason || "";
    if (stage === "Lost") {
      const answer = window.prompt("Optional loss reason", reason);
      if (answer === null) return;
      reason = answer.trim();
    }
    mutate((copy) => {
      const record = copy.opportunities.find((item) => item.id === opportunity.id);
      if (!record) return;
      const prior = record.stage;
      record.stage = stage;
      record.updatedAt = today();
      if (stage === "Lost") record.lossReason = reason;
      record.stageHistory = [...(record.stageHistory || []), { stage, date: today() }];
      addActivity(copy, "stage", "Opportunity moved to " + stage, record.title + " · " + companyName(record.companyId) + (stage === "Lost" && reason ? " · " + reason : ""), "opportunity", record.id);
      if (stage === "Won") addActivity(copy, "won", "Opportunity marked Won", record.title + " · " + companyName(record.companyId), "opportunity", record.id);
      if (stage === "Lost") addActivity(copy, "lost", "Opportunity marked Lost", record.title + (reason ? " · " + reason : ""), "opportunity", record.id);
      if (prior === "Won" || prior === "Lost") record.lossReason = stage === "Lost" ? reason : "";
    });
    notify("Moved to " + stage);
  };

  const createJobFromOpportunity = (opportunity: Opportunity) => {
    if (opportunity.jobId && data.jobs.some((job) => job.id === opportunity.jobId)) {
      notify("This opportunity already has a related job");
      return;
    }
    if (!window.confirm("Create a job from “" + opportunity.title + "”? It will use the existing company and contact.")) return;
    let newJobId = "";
    mutate((copy) => {
      const current = copy.opportunities.find((item) => item.id === opportunity.id);
      if (!current) return;
      if (current.jobId && copy.jobs.some((job) => job.id === current.jobId)) { newJobId = current.jobId; return; }
      newJobId = newId("jb");
      const referenceId = "JOB-" + String(Math.floor(1000 + Math.random() * 8999));
      const job: Job = {
        id: newJobId, title: opportunity.title, referenceId, description: opportunity.description,
        companyId: opportunity.companyId, contactId: opportunity.contactId, opportunityId: opportunity.id,
        category: opportunity.category, status: "New", priority: opportunity.priority, owner: opportunity.owner || "You",
        startDate: "", dueDate: opportunity.expectedDecisionDate || "", completionDate: "",
        nextAction: opportunity.nextAction, notes: opportunity.notes, createdAt: today(), updatedAt: today(),
      };
      copy.jobs.unshift(job);
      current.jobId = newJobId;
      current.updatedAt = today();
      addActivity(copy, "job", "Job created from opportunity", job.title + " · " + job.referenceId, "job", job.id);
      addActivity(copy, "job", "Related job created", job.title + " · " + job.referenceId, "opportunity", current.id);
    });
    notify("Related job created");
    if (newJobId) setDetail({ kind: "job", id: newJobId });
  };

  const addNote = () => {
    if (!detail || !activeDetail || !noteText.trim()) return;
    const body = noteText.trim();
    mutate((copy) => {
      const note: CrmNote = { id: newId("nt"), recordType: detail.kind, recordId: detail.id, body, author: "You", createdAt: new Date().toISOString() };
      copy.notes.unshift(note);
      addActivity(copy, "note", "Note added", body, detail.kind, detail.id);
    });
    setNoteText("");
    notify("Note added");
  };

  const stageDrop = (opportunity: Opportunity, stage: string) => {
    setDragged("");
    if (opportunity.stage !== stage) changeOpportunityStage(opportunity, stage);
  };

  const allSearchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const matches: { kind: Kind; record: any; title: string; subtitle: string }[] = [];
    data.contacts.forEach((record) => {
      const line = [fullName(record), record.email, record.jobTitle, record.country, record.preferredLanguage, companyName(record.companyId)].join(" ").toLowerCase();
      if (line.includes(term)) matches.push({ kind: "contact", record, title: fullName(record), subtitle: record.jobTitle + " · " + companyName(record.companyId) });
    });
    data.companies.forEach((record) => { if ([record.name, record.industry, record.location].join(" ").toLowerCase().includes(term)) matches.push({ kind: "company", record, title: record.name, subtitle: record.industry + " · " + record.location }); });
    data.jobs.forEach((record) => { if ([record.title, record.referenceId, companyName(record.companyId)].join(" ").toLowerCase().includes(term)) matches.push({ kind: "job", record, title: record.title, subtitle: record.referenceId + " · " + companyName(record.companyId) }); });
    data.opportunities.forEach((record) => { if ([record.title, companyName(record.companyId), record.stage].join(" ").toLowerCase().includes(term)) matches.push({ kind: "opportunity", record, title: record.title, subtitle: companyName(record.companyId) + " · " + record.stage }); });
    return matches.slice(0, 7);
  }, [query, data]);

  const addQuick = (kind: Kind) => openNew(kind);
  const quickActions: { label: string; kind: Kind; icon: string }[] = [
    { label: "Add contact", kind: "contact", icon: "users" },
    { label: "Add company", kind: "company", icon: "building" },
    { label: "Create job", kind: "job", icon: "briefcase" },
    { label: "New opportunity", kind: "opportunity", icon: "target" },
    { label: "Add task", kind: "task", icon: "check" },
  ];

  const currentKind = pageKind[page];
  const currentItems: any[] = currentKind ? ((data[plural[currentKind]] as any[]).filter((row) => filter === "Archived" ? row.archived : !row.archived)) : [];
  const columns: Column[] = currentKind === "contact" ? [
    { key: "firstName", label: "CONTACT", render: (r) => <div className="person-cell"><span className="avatar small">{initials(fullName(r))}</span><span><strong>{fullName(r)}</strong><small>{r.email || "No email"}</small></span></div> },
    { key: "country", label: "COUNTRY / REGION", render: (r) => <span className="muted-text">{r.country || "—"}</span> },
    { key: "companyId", label: "COMPANY", render: (r) => <span className="muted-text">{companyName(r.companyId)}</span> },
    { key: "jobTitle", label: "ROLE", render: (r) => <span className="muted-text">{r.jobTitle || "—"}</span> },
    { key: "status", label: "STATUS", render: (r) => <StatusBadge value={r.status} /> },
    { key: "nextFollowUp", label: "NEXT FOLLOW-UP", render: (r) => <span className={r.nextFollowUp && r.nextFollowUp < today() ? "date-overdue" : "muted-text"}>{fmtDate(r.nextFollowUp)}</span> },
  ] : currentKind === "company" ? [
    { key: "name", label: "COMPANY", render: (r) => <div className="company-cell"><span className="company-mark">{initials(r.name)}</span><span><strong>{r.name}</strong><small>{r.website || r.industry}</small></span></div> },
    { key: "industry", label: "INDUSTRY" }, { key: "location", label: "LOCATION" },
    { key: "size", label: "SIZE", render: (r) => <span className="muted-text">{r.size || "—"}</span> },
    { key: "status", label: "STATUS", render: (r) => <StatusBadge value={r.status} /> },
    { key: "companyContacts", label: "CONTACTS", render: (r) => <span className="muted-text">{data.contacts.filter((c) => c.companyId === r.id).length} people</span> },
  ] : currentKind === "job" ? [
    { key: "title", label: "JOB", render: (r) => <div><strong>{r.title}</strong><small className="subline">{r.referenceId}</small></div> },
    { key: "companyId", label: "COMPANY", render: (r) => <span className="muted-text">{companyName(r.companyId)}</span> },
    { key: "status", label: "STATUS", render: (r) => <StatusBadge value={r.status} /> },
    { key: "priority", label: "PRIORITY", render: (r) => <PriorityBadge value={r.priority} /> },
    { key: "owner", label: "OWNER" },
    { key: "dueDate", label: "DUE DATE", render: (r) => <span className={r.dueDate && r.dueDate < today() && !["Completed", "Cancelled"].includes(r.status) ? "date-overdue" : "muted-text"}>{fmtDate(r.dueDate)}</span> },
  ] : [
    { key: "title", label: "OPPORTUNITY", render: (r) => <div><strong>{r.title}</strong><small className="subline">{r.category || "General"}</small></div> },
    { key: "companyId", label: "COMPANY", render: (r) => <span className="muted-text">{companyName(r.companyId)}</span> },
    { key: "stage", label: "STAGE", render: (r) => <StatusBadge value={r.stage} /> },
    { key: "priority", label: "PRIORITY", render: (r) => <PriorityBadge value={r.priority} /> },
    { key: "owner", label: "OWNER" },
    { key: "expectedDecisionDate", label: "DECISION DATE", render: (r) => <span className="muted-text">{fmtDate(r.expectedDecisionDate)}</span> },
  ];

  const term = (localQuery + " " + query).trim().toLowerCase();
  const filteredItems = currentItems.filter((item) => {
    if (!term) return true;
    const text = currentKind === "contact" ? [fullName(item), item.email, item.phone, item.jobTitle, companyName(item.companyId), item.tags].join(" ")
      : currentKind === "company" ? [item.name, item.industry, item.location, item.tags].join(" ")
        : currentKind === "job" ? [item.title, item.referenceId, item.description, item.status, companyName(item.companyId)].join(" ")
          : [item.title, item.description, item.stage, item.category, companyName(item.companyId)].join(" ");
    return text.toLowerCase().includes(term);
  }).filter((item) => {
    if (filter === "Archived") return true;
    if (filter === "All") return true;
    const key = currentKind === "opportunity" ? "stage" : "status";
    return item[key] === filter;
  });
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (!sortKey) return 0;
    const av = String(a[sortKey] || "");
    const bv = String(b[sortKey] || "");
    return av.localeCompare(bv, undefined, { numeric: true }) * (sortAsc ? 1 : -1);
  });
  const perPage = 7;
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / perPage));
  const visibleItems = sortedItems.slice((pageNo - 1) * perPage, pageNo * perPage);
  const filterOptions = currentKind === "contact" ? ["Active", "Lead", "Inactive"] : currentKind === "company" ? ["Active", "Prospect", "Inactive"] : currentKind === "job" ? data.jobStatuses : data.pipelineStages;

  const saveSettings = () => {
    const stages = pipelineText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const statuses = jobStatusText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (stages.length < 2 || new Set(stages).size !== stages.length) { notify("Pipeline needs at least two unique stage names."); return; }
    if (statuses.length < 2 || new Set(statuses).size !== statuses.length) { notify("Jobs need at least two unique statuses."); return; }
    if (!stages.includes("Won") || !stages.includes("Lost")) { notify("Keep Won and Lost in the pipeline to preserve close-out tracking."); return; }
    if (!statuses.includes("Completed") || !statuses.includes("Cancelled")) { notify("Keep Completed and Cancelled in job statuses."); return; }
    const occupiedStages = [...new Set(data.opportunities.map((item) => item.stage).filter((stage) => !stages.includes(stage)))];
    const occupiedStatuses = [...new Set(data.jobs.map((item) => item.status).filter((status) => !statuses.includes(status)))];
    const effectiveStages = [...stages, ...occupiedStages];
    const effectiveStatuses = [...statuses, ...occupiedStatuses];
    mutate((copy) => { copy.pipelineStages = effectiveStages; copy.jobStatuses = effectiveStatuses; copy.organization = orgName.trim() || "My Organization"; });
    setPipelineText(effectiveStages.join("\n"));
    setJobStatusText(effectiveStatuses.join("\n"));
    notify("Settings saved");
  };

  const importCsv = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const parsedRows = parseCsv(text.replace(/^\uFEFF/, ""));
    if (parsedRows.length < 2) { notify("CSV needs a header row and at least one contact."); return; }
    const headers = parsedRows[0].map(normalizeCsvHeader);
    const rows = parsedRows.slice(1);
    const companyHeaders = new Set([
      "company", "companyname", "companynameforemails", "website", "companywebsite", "industry", "employees",
      "companysize", "companyaddress", "companycity", "companystate", "companycountry", "companyphone",
      "companylinkedinurl", "keywords", "technologies", "annualrevenue", "totalfunding", "latestfunding",
      "latestfundingamount", "lastraisedat", "parentcompany", "parentcompanyapollo",
      "parentcompanyapollodata", "parentcompanyapolladataorganizationid", "apolloaccountid", "sic", "siccodes",
      "naics", "naicscodes", "accountowner", "numberofretaillocations",
    ]);
    const contactStandardHeaders = new Set([
      "firstname", "first", "lastname", "last", "email", "emailaddress", "phone", "phonenumber", "jobtitle",
      "title", "country", "countryregion", "region", "preferredlanguage", "language", "contactlanguage", "source", "tags",
    ]);
    let imported = 0, duplicates = 0, companiesCreated = 0;
    mutate((copy) => {
      rows.forEach((row) => {
        const value = (keys: string[]) => {
          const index = headers.findIndex((header) => keys.includes(header));
          return index >= 0 ? (row[index] || "").trim() : "";
        };
        const companyNameCsv = value(["companyname", "company", "companynameforemails"]);
        const importedCompanyFields: Record<string, string> = {};
        headers.forEach((header, index) => {
          const fieldValue = (row[index] || "").trim();
          if (fieldValue && companyHeaders.has(header) && !["company", "companyname"].includes(header)) {
            importedCompanyFields[parsedRows[0][index].trim()] = fieldValue;
          }
        });
        const website = value(["website", "companywebsite"]);
        const industry = value(["industry"]);
        const size = value(["employees", "companysize"]);
        const companyLocation = [
          value(["companyaddress"]),
          value(["companycity"]),
          value(["companystate"]),
          value(["companycountry"]),
        ].filter(Boolean).join(", ");
        let company: Company | undefined;
        if (companyNameCsv) {
          const normalizedName = normalizeCompanyName(companyNameCsv);
          company = copy.companies.find((item) => normalizeCompanyName(item.name) === normalizedName);
          if (company) {
            company.website = website || company.website;
            company.industry = industry || company.industry;
            company.size = size || company.size;
            company.location = companyLocation || company.location;
            company.customFields = { ...company.customFields, ...importedCompanyFields };
            company.updatedAt = today();
          } else {
            company = {
              id: newId("co"), name: companyNameCsv, website, industry, size, location: companyLocation,
              description: "", status: "Prospect", tags: "", notes: "", createdAt: today(), updatedAt: today(),
              customFields: importedCompanyFields,
            };
            copy.companies.unshift(company);
            companiesCreated += 1;
          }
        }

        const email = value(["email", "emailaddress"]);
        const firstName = value(["firstname", "first"]);
        const lastName = value(["lastname", "last"]);
        const customFields: Record<string, string> = {};
        headers.forEach((header, index) => {
          const fieldValue = (row[index] || "").trim();
          if (fieldValue && !companyHeaders.has(header) && !contactStandardHeaders.has(header)) {
            customFields[parsedRows[0][index].trim()] = fieldValue;
          }
        });
        const existingContact = email
          ? copy.contacts.find((contact) => contact.email.toLowerCase() === email.toLowerCase())
          : undefined;
        if (existingContact) {
          existingContact.firstName = existingContact.firstName || firstName;
          existingContact.lastName = existingContact.lastName || lastName;
          existingContact.phone = existingContact.phone || value(["workdirectphone", "mobilephone", "corporatephone", "phone", "phonenumber", "homephone", "otherphone"]);
          existingContact.country = existingContact.country || value(["country", "countryregion", "region"]);
          existingContact.preferredLanguage = existingContact.preferredLanguage || value(["preferredlanguage", "language", "contactlanguage"]);
          existingContact.jobTitle = existingContact.jobTitle || value(["jobtitle", "title"]);
          existingContact.companyId = existingContact.companyId || company?.id || "";
          existingContact.customFields = { ...existingContact.customFields, ...customFields };
          existingContact.updatedAt = today();
          duplicates += 1;
          return;
        }
        if (!firstName && !lastName) return;
        const contact: Contact = {
          id: newId("ct"), firstName, lastName, email,
          phone: value(["workdirectphone", "mobilephone", "corporatephone", "phone", "phonenumber", "homephone", "otherphone"]),
          country: value(["country", "countryregion", "region"]),
          preferredLanguage: value(["preferredlanguage", "language", "contactlanguage"]),
          jobTitle: value(["jobtitle", "title"]), companyId: company?.id || "",
          source: value(["source"]) || "Apollo CSV import",
          tags: value(["tags", "lists"]), status: "Lead",
          notes: "", lastContacted: "", nextFollowUp: "", createdAt: today(), updatedAt: today(),
          customFields,
        };
        copy.contacts.unshift(contact); imported += 1;
        addActivity(copy, "contact", "Contact imported", fullName(contact), "contact", contact.id);
      });
    });
    notify("Imported " + imported + " contact" + (imported === 1 ? "" : "s") + " and " + companiesCreated + " compan" + (companiesCreated === 1 ? "y" : "ies") + (duplicates ? " · skipped " + duplicates + " duplicate" + (duplicates === 1 ? "" : "s") : ""));
    if (importRef.current) importRef.current.value = "";
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "northstar-crm-export-" + today() + ".json";
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Workspace export downloaded");
  };

  const tasksForView = data.tasks.filter((task) => {
    const date = task.dueDate.slice(0, 10);
    if (taskTab === "My Tasks") return task.owner === "You" && !["Completed", "Cancelled"].includes(task.status);
    if (taskTab === "Due Today") return date === today() && !["Completed", "Cancelled"].includes(task.status);
    if (taskTab === "Upcoming") return date > today() && !["Completed", "Cancelled"].includes(task.status);
    if (taskTab === "Overdue") return date < today() && !["Completed", "Cancelled"].includes(task.status);
    if (taskTab === "Completed") return task.status === "Completed";
    return true;
  }).filter((task) => (task.title + " " + getRecordLabel(task.recordType as Kind, task.recordId)).toLowerCase().includes((localQuery + " " + query).trim().toLowerCase()));

  const activityItems = data.activities.filter((item) => {
    const text = (item.title + " " + item.detail + " " + item.user).toLowerCase();
    return text.includes(term);
  });

  const memberInitials = initials(displayName);
  if (loadError) return <main className="workspace-state"><div className="workspace-state-card"><div className="brand-mark"><span className="brand-star">✦</span></div><h1>Could not load your workspace</h1><p>{loadError}</p><div className="workspace-state-actions"><button className="button button-primary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button><button className="button button-secondary" onClick={onSignOut}>Sign out</button></div></div></main>;
  if (!dataReady) return <main className="workspace-state"><div className="workspace-loading"><span className="auth-spinner" /><span>Loading your workspace…</span></div></main>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><span className="brand-star">✦</span></div><span className="brand-name">northstar<span>CRM</span></span></div>
        <div className="workspace-switch"><div className="workspace-avatar">{initials(data.organization)}</div><div className="workspace-copy"><strong>{data.organization}</strong><small>Workspace</small></div><Icon name="chevronDown" size={15} /></div>
        <nav className="main-nav" aria-label="Main navigation">
          {nav.map((item) => <div key={item.page}>
            {item.group && <div className="nav-group">{item.group}</div>}
            <button className={"nav-item " + (page === item.page ? "active" : "")} onClick={() => setPage(item.page)}>
              <Icon name={item.icon} size={18} /><span>{item.page}</span>
              {item.page === "Tasks & Follow-ups" && todayTasks.length > 0 && <span className="nav-count">{todayTasks.length}</span>}
            </button>
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-note"><span className={"sync-dot sync-" + syncState} /><span><strong>{isMockAuthEnabled ? "Local demo API" : "Supabase storage"}</strong><small>{syncState === "saving" ? "Saving changes…" : syncState === "error" ? "Sync needs attention" : "Changes synced"}</small></span></div>
          <button className="user-switch" onClick={() => setMenu(menu === "profile" ? null : "profile")}><span className="avatar user-avatar">{memberInitials}</span><span><strong>{displayName}</strong><small>Workspace member</small></span><Icon name="dots" size={17} /></button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={14} /><strong>{page}</strong></div>
          <div className="top-actions">
            <div className={"global-search " + (searchFocus ? "focused" : "")}>
              <Icon name="search" size={17} />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPageNo(1); }} onFocus={() => setSearchFocus(true)} onBlur={() => window.setTimeout(() => setSearchFocus(false), 160)} placeholder="Search anything..." aria-label="Search contacts, companies, jobs and opportunities" />
              <kbd>⌘ K</kbd>
              {searchFocus && query && <div className="search-popover">{allSearchResults.length ? allSearchResults.map((result) => <button key={result.kind + result.record.id} onMouseDown={() => openDetail(result.kind, result.record.id)}><span className="search-result-icon"><Icon name={result.kind === "company" ? "building" : result.kind === "job" ? "briefcase" : result.kind === "opportunity" ? "target" : "users"} size={16} /></span><span><strong>{result.title}</strong><small>{result.subtitle}</small></span><span className="search-kind">{kindLabel[result.kind]}</span></button>) : <div className="search-empty">No records found for “{query}”</div>}</div>}
            </div>
            <div className="top-menu-wrap">
              <button className={"icon-button notification-button " + (menu === "notifications" ? "selected" : "")} aria-label="Notifications" onClick={() => setMenu(menu === "notifications" ? null : "notifications")}><Icon name="bell" size={19} />{todayTasks.length > 0 && <i />}</button>
              {menu === "notifications" && <div className="header-popover notification-popover"><div className="popover-heading"><strong>Today</strong><span>{todayTasks.length} due</span></div>{todayTasks.length ? todayTasks.slice(0, 4).map((task) => <button className="notice-row" key={task.id} onClick={() => openDetail("task", task.id)}><span className="notice-icon"><Icon name="check" size={15} /></span><span><strong>{task.title}</strong><small>{fmtTime(task.dueDate)} · {getRecordLabel(task.recordType as Kind, task.recordId)}</small></span></button>) : <div className="empty-small">You’re all caught up for today.</div>}</div>}
            </div>
            <div className="top-menu-wrap">
              <button className="top-profile" onClick={() => setMenu(menu === "profile" ? null : "profile")}><span className="avatar user-avatar">{memberInitials}</span><span>{displayName}</span><Icon name="chevronDown" size={14} /></button>
              {menu === "profile" && <div className="header-popover profile-popover"><div className="profile-popover-head"><span className="avatar user-avatar">{memberInitials}</span><span><strong>{displayName}</strong><small>{userEmail}</small></span></div><button onClick={() => { setPage("Settings"); setMenu(null); }}>Profile & settings</button><button onClick={() => { setPage("Settings"); setMenu(null); }}>Workspace settings</button><button className="sign-out-button" onClick={onSignOut}>Sign out</button></div>}
            </div>
          </div>
        </header>

        <div className="content-area">
          <div className="page-topline"><div><div className="eyebrow">NORTHSTAR CRM <span className="mock-pill">PRIVATE WORKSPACE</span></div><h1>{page === "Tasks & Follow-ups" ? "Tasks & follow-ups" : page}</h1><p>{pageDescriptions[page]}</p></div>
            {page !== "Dashboard" && page !== "Activities" && page !== "Settings" && page !== "Outreach" && page !== "Meetings" && <button className="button button-primary" onClick={() => addQuick(currentKind || "task")}><Icon name="plus" size={17} />{page === "Tasks & Follow-ups" ? "Add task" : "Add " + kindLabel[currentKind!].toLowerCase()}</button>}
          </div>

          {page === "Outreach" && <OutreachPage data={data} senderName={displayName} />}
          {page === "Dashboard" && <Dashboard data={data} metrics={metrics} userName={displayName} syncState={syncState} onQuick={addQuick} onPage={setPage} onActivity={(item) => openDetail(item.recordType as Kind, item.recordId)} />}
          {page === "Meetings" && <MeetingsPage contacts={data.contacts} />}

          {currentKind && <section className="panel records-panel">
            <div className="panel-toolbar">
              <div className="record-tabs"><button className={filter === "All" ? "active" : ""} onClick={() => setFilter("All")}>All records <span>{(data[plural[currentKind]] as any[]).filter((r) => !r.archived).length}</span></button><button className={filter === "Archived" ? "active" : ""} onClick={() => setFilter("Archived")}>Archived</button></div>
              <div className="toolbar-actions">
                {currentKind === "contact" && <><input ref={importRef} type="file" accept=".csv,text/csv" className="hidden-input" onChange={(e) => importCsv(e.target.files?.[0])} /><button className="button button-quiet" onClick={() => importRef.current?.click()}><Icon name="upload" size={16} />Import CSV</button></>}
                {currentKind === "job" && <div className="view-toggle"><button aria-label="Table view" className={view === "table" ? "selected" : ""} onClick={() => setView("table")}><Icon name="list" size={16} /></button><button aria-label="Board view" className={view === "board" ? "selected" : ""} onClick={() => setView("board")}><Icon name="board" size={16} /></button></div>}
                {currentKind === "opportunity" && <div className="view-toggle"><button aria-label="Table view" className={view === "table" ? "selected" : ""} onClick={() => setView("table")}><Icon name="list" size={16} /></button><button aria-label="Pipeline board" className={view === "board" ? "selected" : ""} onClick={() => setView("board")}><Icon name="board" size={16} /></button></div>}
                <div className="table-search"><Icon name="search" size={16} /><input value={localQuery} onChange={(e) => { setLocalQuery(e.target.value); setPageNo(1); }} placeholder={"Search " + page.toLowerCase() + "..."} /></div>
                <select className="filter-select" aria-label="Filter status" value={filter === "Archived" ? "Archived" : filter} onChange={(e) => { setFilter(e.target.value); setPageNo(1); }}><option value="All">All statuses</option><option value="Archived">Archived</option>{filterOptions.map((option) => <option key={option}>{option}</option>)}</select>
              </div>
            </div>
            {view === "board" && (currentKind === "job" ? <JobBoard jobs={filteredItems} statuses={data.jobStatuses} data={data} onOpen={openDetail} onDrop={(job, status) => {
              mutate((copy) => { const found = copy.jobs.find((item) => item.id === job.id); if (found) { found.status = status as Job["status"]; found.updatedAt = today(); if (status === "Completed") found.completionDate = today(); addActivity(copy, "job", "Job moved to " + status, found.title + " · " + found.referenceId, "job", found.id); } });
              notify("Job moved to " + status);
            }} onDrag={setDragged} dragged={dragged} /> : <OpportunityBoard opportunities={filteredItems} stages={data.pipelineStages} data={data} onOpen={openDetail} onDrop={stageDrop} onDrag={setDragged} dragged={dragged} />)}
            {view === "table" && <><div className="table-scroll"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column.key}><button onClick={() => { if (sortKey === column.key) setSortAsc(!sortAsc); else { setSortKey(column.key); setSortAsc(true); } }}>{column.label}{sortKey === column.key ? (sortAsc ? " ↑" : " ↓") : ""}</button></th>)}<th aria-label="Record actions" /></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} onClick={() => openDetail(currentKind, item.id)}><td colSpan={columns.length + 1} className="row-reset"><div className="table-grid" style={{ gridTemplateColumns: "repeat(" + columns.length + ", minmax(120px, 1fr)) 32px" }}>{columns.map((column) => <div key={column.key} className="table-cell">{column.render ? column.render(item) : <span>{item[column.key] || "—"}</span>}</div>)}<button className="row-more" aria-label="Open record"><Icon name="chevron" size={16} /></button></div></td></tr>)}</tbody></table></div>
              {visibleItems.length === 0 && <EmptyState title={term ? "No matching records" : filter === "Archived" ? "No archived records" : "Nothing here yet"} detail={term ? "Try changing your search or filters." : "Create a record to start building your workspace."} action={!term && filter !== "Archived" ? <button className="button button-primary" onClick={() => openNew(currentKind)}><Icon name="plus" size={15} />Add {kindLabel[currentKind].toLowerCase()}</button> : undefined} />}
              {sortedItems.length > 0 && <div className="table-footer"><span>Showing <strong>{(pageNo - 1) * perPage + 1}–{Math.min(pageNo * perPage, sortedItems.length)}</strong> of <strong>{sortedItems.length}</strong> records</span><div className="pagination"><button disabled={pageNo <= 1} onClick={() => setPageNo(Math.max(1, pageNo - 1))}>Previous</button><span>Page {pageNo} of {totalPages}</span><button disabled={pageNo >= totalPages} onClick={() => setPageNo(Math.min(totalPages, pageNo + 1))}>Next</button></div></div>}</>}
          </section>}

          {page === "Tasks & Follow-ups" && <section className="panel task-panel">
            <div className="panel-toolbar task-toolbar"><div className="task-tabs">{["My Tasks", "Due Today", "Upcoming", "Overdue", "Completed", "All"].map((tab) => <button key={tab} className={taskTab === tab ? "active" : ""} onClick={() => setTaskTab(tab)}>{tab}{tab === "Due Today" && todayTasks.length ? <span className="tab-count">{todayTasks.length}</span> : null}</button>)}</div><div className="table-search"><Icon name="search" size={16} /><input value={localQuery} onChange={(e) => setLocalQuery(e.target.value)} placeholder="Search tasks..." /></div></div>
            <div className="task-list">{tasksForView.map((task) => <TaskRow key={task.id} task={task} getRecordLabel={getRecordLabel} onOpen={() => openDetail("task", task.id)} onToggle={() => updateTaskStatus(task, task.status === "Completed" ? "To Do" : "Completed")} />)}</div>
            {!tasksForView.length && <EmptyState title="No tasks in this view" detail="Add a task or try another view to keep your follow-ups moving." action={<button className="button button-primary" onClick={() => openNew("task")}><Icon name="plus" size={15} />Add task</button>} />}
          </section>}

          {page === "Activities" && <section className="panel activity-page-panel"><div className="panel-toolbar"><div><strong>Activity timeline</strong><span className="toolbar-subtitle">Recent record changes across your workspace</span></div><div className="table-search"><Icon name="search" size={16} /><input value={localQuery} onChange={(e) => setLocalQuery(e.target.value)} placeholder="Search activity..." /></div></div><ActivityList items={activityItems} onClick={(item) => openDetail(item.recordType as Kind, item.recordId)} getRecordLabel={getRecordLabel} /><div className="mock-footnote">New activity is added as your team updates records.</div></section>}

          {page === "Settings" && <div className="settings-grid">
            <section className="panel settings-card"><div className="settings-title"><div className="settings-icon"><Icon name="building" /></div><div><h2>Organization</h2><p>Basic details for your workspace</p></div></div><label className="field-label">Workspace name<input className="form-input" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></label></section>
            <section className="panel settings-card"><div className="settings-title"><div className="settings-icon"><Icon name="users" /></div><div><h2>Your profile</h2><p>This name appears in the CRM and in email signatures.</p></div></div>{profileError && <div className="outreach-message error-message" role="alert">{profileError}</div>}{profileMessage && <div className="outreach-message success-message" role="status">{profileMessage}</div>}<label className="field-label">Signed-in name<input className="form-input" value={profileName} maxLength={100} onChange={(event) => { setProfileName(event.target.value); setProfileMessage(""); setProfileError(""); }} /></label><div className="settings-inline"><div><label className="field-label">Account email</label><div className="readonly-field">{userEmail}</div></div><div className="settings-profile-save"><button className="button button-primary" disabled={profileBusy || !profileName.trim() || profileName.trim() === displayName} onClick={() => void saveProfileName()}>{profileBusy ? "Saving…" : "Save name"}</button></div></div></section>
            <section className="panel settings-card"><div className="settings-title"><div className="settings-icon"><Icon name="target" /></div><div><h2>Opportunity pipeline</h2><p>One stage per line. Order controls the board.</p></div></div><label className="field-label">Stages<textarea className="form-input settings-textarea" value={pipelineText} onChange={(e) => setPipelineText(e.target.value)} /></label><span className="field-help">Keep Won and Lost as the close stages. Stages with existing records stay visible.</span></section>
            <section className="panel settings-card"><div className="settings-title"><div className="settings-icon"><Icon name="briefcase" /></div><div><h2>Job statuses</h2><p>Configure the columns in the jobs board.</p></div></div><label className="field-label">Statuses<textarea className="form-input settings-textarea" value={jobStatusText} onChange={(e) => setJobStatusText(e.target.value)} /></label><span className="field-help">Keep Completed and Cancelled. Statuses with existing jobs stay visible.</span></section>
            <section className="panel settings-card"><div className="settings-title"><div className="settings-icon"><Icon name="download" /></div><div><h2>Data & storage</h2><p>Your private CRM workspace</p></div></div><div className="storage-callout"><span className={"sync-dot sync-" + syncState} /><span><strong>{syncState === "error" ? "Sync needs attention" : syncState === "saving" ? (isMockAuthEnabled ? "Saving through local API" : "Saving to Supabase") : (isMockAuthEnabled ? "Saved through local API" : "Stored in Supabase")}</strong><small>{syncState === "error" ? "Your latest change could not be saved. Check the API connection and try editing again." : isMockAuthEnabled ? "Demo records are saved by the NestJS API under the local demo identity." : "Records are associated with your signed-in account and saved through the NestJS API."}</small></span></div><div className="settings-actions"><button className="button button-secondary" onClick={exportData}><Icon name="download" size={16} />Export JSON</button></div></section>
            <EmailProvidersSettings />
            <GroqDraftSettings />
            <div className="settings-save"><span>{isMockAuthEnabled ? "Demo settings sync through the local NestJS API." : "Settings sync through NestJS to your Supabase workspace."}</span><button className="button button-primary" onClick={saveSettings}>Save settings</button></div>
          </div>}
        </div>
      </main>

      {menu === "profile" && <button className="dismiss-overlay" aria-label="Close menu" onClick={() => setMenu(null)} />}
      {dialog && <RecordDialog kind={dialog.kind} record={dialog.record} data={data} onClose={() => setDialog(null)} onSave={(form) => persistRecord(dialog.kind, form, dialog.record)} />}
      {detail && activeDetail && <DetailPanel kind={detail.kind} record={activeDetail} data={data} senderName={displayName} notes={data.notes.filter((note) => note.recordType === detail.kind && note.recordId === detail.id)} activities={data.activities.filter((item) => item.recordType === detail.kind && item.recordId === detail.id)} getRecordLabel={getRecordLabel} onClose={() => setDetail(null)} onEdit={() => setDialog({ kind: detail.kind, record: activeDetail })} onArchive={() => archiveRecord(detail.kind, activeDetail)} onRestore={() => restoreRecord(detail.kind, activeDetail)} onNote={addNote} noteText={noteText} setNoteText={setNoteText} onOpen={openDetail} onStage={(stage) => detail.kind === "opportunity" && changeOpportunityStage(activeDetail, stage)} onCreateJob={() => detail.kind === "opportunity" && createJobFromOpportunity(activeDetail)} onTaskStatus={(status) => detail.kind === "task" && updateTaskStatus(activeDetail, status)} />}
      {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
    </div>
  );
}

const pageDescriptions: Record<Page, string> = {
  Outreach: "Send relevant emails, follow replies, and see which links get attention.",
  Dashboard: "Your relationships, work, and next steps at a glance.",
  Contacts: "Keep every conversation connected to the people behind the work.",
  Companies: "The organizations and teams you build relationships with.",
  Jobs: "Track active work from kickoff through completion.",
  Opportunities: "Move potential work forward with a clear pipeline.",
  "Tasks & Follow-ups": "Keep your next steps visible and close the loop.",
  Meetings: "Confirmed Cal.com bookings and upcoming conversations with contacts.",
  Activities: "A chronological view of what has changed across your CRM.",
  Settings: "Set up your workspace and tailor the CRM to your team.",
};

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <span className={"status-badge status-" + normalized}><i />{value}</span>;
}
function PriorityBadge({ value }: { value: string }) {
  return <span className={"priority priority-" + value.toLowerCase()}><i />{value}</span>;
}
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="spark" size={21} /></div><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

function Dashboard({ data, metrics, userName, syncState, onQuick, onPage, onActivity }: { data: CrmData; metrics: CrmAnalytics; userName: string; syncState: "loading" | "saving" | "saved" | "error"; onQuick: (kind: Kind) => void; onPage: (page: Page) => void; onActivity: (item: Activity) => void }) {
  const [meetings, setMeetings] = useState<CalendarMeeting[]>([]);
  const [meetingLoadError, setMeetingLoadError] = useState("");
  const [meetingLoading, setMeetingLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const items = await getCalendarMeetings();
        if (alive) { setMeetings(items); setMeetingLoadError(""); }
      } catch (error: unknown) {
        if (alive) setMeetingLoadError(error instanceof Error ? error.message : "Could not load upcoming meetings.");
      } finally {
        if (alive) setMeetingLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const upcomingMeetings = meetings.filter((meeting) => meeting.status === "booked" && Date.parse(meeting.startTime) >= Date.now())
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)).slice(0, 4);
  const meetingCount = meetings.filter((meeting) => meeting.status === "booked" && Date.parse(meeting.startTime) >= Date.now()).length;
  const pipeline = metrics.pipeline.filter((item) => !["Won", "Lost"].includes(item.stage));
  const maxCount = Math.max(1, ...pipeline.map((item) => item.count));
  const pipelineValue = metrics.openOpportunityValue;
  const fmtEstimate = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value);

  return <div className="dashboard">
    <div className="dashboard-welcome"><div><span className="welcome-date">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span><h2>Welcome, {userName.split(/\s+/)[0]} <span>✦</span></h2><p>Here’s what’s happening across your workspace today.</p></div><button className="button button-secondary" onClick={() => onPage("Activities")}><Icon name="activity" size={16} />View activity</button></div>
    <div className="metric-grid dashboard-priority-metrics">
      <MetricCard label="Total contacts" value={metrics.totalContacts} icon="users" tint="blue" sub="People in your network" />
      <MetricCard label="Open opportunities" value={metrics.openOpportunities} icon="target" tint="teal" sub="Potential engagements" />
      <MetricCard label="Need attention" value={metrics.needsAttention} icon="spark" tint="red" sub="Follow-up due or overdue" />
      <MetricCard label="Upcoming meetings" value={meetingLoadError ? "—" : meetingCount} icon="calendar" tint="violet" sub={meetingLoadError ? "Could not load bookings" : "Confirmed Cal.com bookings"} />
    </div>
    <div className="dashboard-main-grid">
      <section className="panel pipeline-panel"><div className="section-heading"><div><h3>Opportunity pipeline</h3><p>Open opportunities by stage</p></div><button className="text-button" onClick={() => onPage("Opportunities")}>View pipeline <Icon name="chevron" size={14} /></button></div>
        <div className="pipeline-summary"><div><strong>{metrics.openOpportunities}</strong><span>open opportunities</span></div><div className="pipeline-value"><small>Active estimate</small><strong>{fmtEstimate(pipelineValue)}</strong></div></div>
        <div className="pipeline-bars">{pipeline.map(({ stage, count }) => <button className="pipeline-row" key={stage} onClick={() => onPage("Opportunities")}><span className="pipeline-stage-name">{stage}<small>{count} {count === 1 ? "opportunity" : "opportunities"}</small></span><span className="bar-track"><i style={{ width: (count / maxCount * 100) + "%" }} /></span><strong>{count}</strong></button>)}</div>
        <div className="pipeline-footer"><span>Won <strong>{metrics.totalWon}</strong></span><span>Lost <strong>{metrics.totalLost}</strong></span><button onClick={() => onPage("Opportunities")}>See all stages <Icon name="chevron" size={14} /></button></div>
      </section>
      <section className="panel upcoming-panel"><div className="section-heading"><div><h3>Upcoming meetings</h3><p>Confirmed bookings from Cal.com</p></div><button className="text-button" onClick={() => onPage("Meetings")}>View all <Icon name="chevron" size={14} /></button></div>
        <div className="upcoming-list">{upcomingMeetings.map((meeting) => <button className="upcoming-item meeting-upcoming-item" key={meeting.id} onClick={() => onPage("Meetings")}><span className="meeting-date-icon"><Icon name="calendar" size={16} /></span><span className="upcoming-copy"><strong>{meeting.title}</strong><small>{meeting.attendeeName || meeting.attendeeEmail}</small></span><span className="upcoming-date">{fmtDate(meeting.startTime)}<small>{fmtTime(meeting.startTime)}</small></span></button>)}
        {!upcomingMeetings.length && <EmptyState title={meetingLoading ? "Loading bookings…" : meetingLoadError ? "Could not load bookings" : "No upcoming meetings"} detail={meetingLoadError || "Connect Cal.com to see confirmed bookings here."} action={<button className="button button-secondary" onClick={() => onPage("Meetings")}>{meetingLoadError ? "Retry in Meetings" : "Set up Cal.com"}</button>} />}</div>
      </section>
    </div>
    <div className="dashboard-bottom-grid">
      <section className="panel recent-panel"><div className="section-heading"><div><h3>Recent activity</h3><p>Latest updates from your workspace</p></div><button className="text-button" onClick={() => onPage("Activities")}>View timeline <Icon name="chevron" size={14} /></button></div><ActivityList items={data.activities.slice(0, 5)} onClick={onActivity} getRecordLabel={(kind, id) => { const key = kind === "contact" ? "contacts" : kind === "company" ? "companies" : kind === "job" ? "jobs" : kind === "task" ? "tasks" : "opportunities"; const record = (data[key as keyof CrmData] as any[]).find((item) => item.id === id); return record ? (record.firstName ? fullName(record) : record.name || record.title) : "Record"; }} /></section>
      <section className="panel quick-panel"><div className="section-heading"><div><h3>Quick actions</h3><p>Make your next move</p></div></div><div className="quick-actions">{[
        { label: "Add contact", kind: "contact" as Kind, icon: "users", color: "blue" },
        { label: "Add company", kind: "company" as Kind, icon: "building", color: "violet" },
        { label: "Create job", kind: "job" as Kind, icon: "briefcase", color: "orange" },
        { label: "New opportunity", kind: "opportunity" as Kind, icon: "target", color: "teal" },
        { label: "Add task", kind: "task" as Kind, icon: "check", color: "green" },
      ].map((action) => <button key={action.kind} onClick={() => onQuick(action.kind)}><span className={"quick-icon " + action.color}><Icon name={action.icon} size={17} /></span><span>{action.label}</span><Icon name="chevron" size={15} /></button>)}</div></section>
    </div>
    <div className="dashboard-disclaimer"><span className={"sync-dot sync-" + syncState} />{syncState === "saved" ? (isMockAuthEnabled ? "Your demo workspace is saved through the local NestJS API." : "Your private workspace is synced through NestJS to Supabase.") : syncState === "saving" ? "Saving your private workspace through NestJS…" : "Backend sync needs attention. Your recent changes may not be saved."}</div>
  </div>;
}

function MetricCard({ label, value, icon, tint, sub }: { label: string; value: number | string; icon: string; tint: string; sub: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={"metric-icon " + tint}><Icon name={icon} size={17} /></span></div><strong className="metric-value">{value.toLocaleString()}</strong><small>{sub}</small></div>;
}

function ActivityList({ items, onClick, getRecordLabel, interactive = true }: { items: Activity[]; onClick: (item: Activity) => void; getRecordLabel: (kind: Kind, id: string) => string; interactive?: boolean }) {
  if (!items.length) return <div className="activity-empty">No activity to show yet.</div>;
  return <div className="activity-list">{items.map((item) => {
    const content = <><span className={"activity-icon activity-" + item.type}><Icon name={item.type === "note" ? "note" : item.type === "task" ? "check" : item.type === "job" ? "briefcase" : item.type === "contact" ? "users" : item.type === "company" ? "building" : item.type === "won" ? "spark" : "target"} size={15} /></span><span className="activity-copy"><strong>{item.title}</strong><small>{item.detail || getRecordLabel(item.recordType as Kind, item.recordId)}</small></span><span className="activity-time">{fmtDate(item.createdAt)}<small>{fmtTime(item.createdAt)}</small></span></>;
    return interactive ? <button className="activity-row" key={item.id} onClick={() => onClick(item)}>{content}</button> : <div className="activity-row" key={item.id}>{content}</div>;
  })}</div>;
}

function TaskRow({ task, getRecordLabel, onOpen, onToggle }: { task: CrmTask; getRecordLabel: (kind: Kind, id: string) => string; onOpen: () => void; onToggle: () => void }) {
  return <div className={"task-row " + (task.status === "Completed" ? "task-done" : "")}><button className={"task-check " + (task.status === "Completed" ? "checked" : "")} aria-label={task.status === "Completed" ? "Reopen task" : "Complete task"} onClick={onToggle}>{task.status === "Completed" ? "✓" : ""}</button><button className="task-row-main" onClick={onOpen}><span><strong>{task.title}</strong><small>{task.description || "No description"}</small></span></button><button className="task-related" onClick={onOpen}><span className="relation-icon"><Icon name={task.recordType === "job" ? "briefcase" : task.recordType === "company" ? "building" : task.recordType === "contact" ? "users" : "target"} size={14} /></span>{getRecordLabel(task.recordType as Kind, task.recordId)}</button><PriorityBadge value={task.priority} /><span className={"task-date " + (task.status !== "Completed" && task.dueDate.slice(0, 10) < today() ? "date-overdue" : "")}><Icon name="calendar" size={14} />{fmtDate(task.dueDate)}{fmtTime(task.dueDate) ? " · " + fmtTime(task.dueDate) : ""}</span><StatusBadge value={task.status} /><button className="row-more" onClick={onOpen} aria-label="Open task"><Icon name="chevron" size={15} /></button></div>;
}

function JobBoard({ jobs, statuses, data, onOpen, onDrop, onDrag, dragged }: { jobs: Job[]; statuses: string[]; data: CrmData; onOpen: (kind: Kind, id: string) => void; onDrop: (job: Job, status: string) => void; onDrag: (id: string) => void; dragged: string }) {
  return <div className="kanban-board">{statuses.map((status) => <div key={status} className="kanban-column" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const job = jobs.find((item) => item.id === dragged); if (job) onDrop(job, status); }}><div className="kanban-heading"><StatusBadge value={status} /><span>{jobs.filter((job) => job.status === status).length}</span></div><div className="kanban-cards">{jobs.filter((job) => job.status === status).map((job) => <button draggable onDragStart={() => onDrag(job.id)} onDragEnd={() => onDrag("")} key={job.id} className="kanban-card" onClick={() => onOpen("job", job.id)}><small className="card-reference">{job.referenceId}</small><strong>{job.title}</strong><span>{data.companies.find((c) => c.id === job.companyId)?.name || "No company"}</span><div><PriorityBadge value={job.priority} /><small>{fmtDate(job.dueDate)}</small></div></button>)}</div></div>)}</div>;
}

function OpportunityBoard({ opportunities, stages, data, onOpen, onDrop, onDrag, dragged }: { opportunities: Opportunity[]; stages: string[]; data: CrmData; onOpen: (kind: Kind, id: string) => void; onDrop: (opportunity: Opportunity, stage: string) => void; onDrag: (id: string) => void; dragged: string }) {
  return <div className="kanban-board opportunity-board">{stages.map((stage) => <div key={stage} className="kanban-column" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const opportunity = opportunities.find((item) => item.id === dragged); if (opportunity) onDrop(opportunity, stage); }}><div className="kanban-heading"><span className={"stage-dot stage-color-" + Math.max(0, stages.indexOf(stage))} /><strong>{stage}</strong><span>{opportunities.filter((opportunity) => opportunity.stage === stage).length}</span></div><div className="kanban-cards">{opportunities.filter((opportunity) => opportunity.stage === stage).map((opportunity) => <button draggable onDragStart={() => onDrag(opportunity.id)} onDragEnd={() => onDrag("")} key={opportunity.id} className={"kanban-card opportunity-card " + (dragged === opportunity.id ? "dragging" : "")} onClick={() => onOpen("opportunity", opportunity.id)}><strong>{opportunity.title}</strong><span>{data.companies.find((c) => c.id === opportunity.companyId)?.name || "No company"}</span><div className="opp-card-contact">{fullName(data.contacts.find((contact) => contact.id === opportunity.contactId))}</div><div><PriorityBadge value={opportunity.priority} /><small>{fmtDate(opportunity.expectedDecisionDate)}</small></div><small className="next-action">{opportunity.nextAction || "No next action"}</small></button>)}</div></div>)}</div>;
}

const sourceOptions = ["Referral", "Website", "Event", "Partner", "Outbound", "Other"];
const priorityOptions = ["Low", "Medium", "High", "Urgent"];
function fieldsFor(kind: Kind, data: CrmData, taskType?: string): Field[] {
  const companyOptions = ["", ...data.companies.map((item) => item.id)];
  const contactOptions = ["", ...data.contacts.map((item) => item.id)];
  const oppOptions = ["", ...data.opportunities.map((item) => item.id)];
  const jobOptions = ["", ...data.jobs.map((item) => item.id)];
  const people = ["You"];
  const choices = (labels: string[], values?: string[]) => labels.map((label, index) => values ? values[index] : label);
  if (kind === "contact") return [
    { key: "firstName", label: "First name", required: true }, { key: "lastName", label: "Last name", required: true },
    { key: "email", label: "Email", type: "email" }, { key: "phone", label: "Phone", type: "tel" },
    { key: "website", label: "Website", type: "url", placeholder: "https://example.com" },
    { key: "country", label: "Country / region" }, { key: "preferredLanguage", label: "Preferred language", placeholder: "e.g. French" },
    { key: "jobTitle", label: "Job title" }, { key: "companyId", label: "Company", type: "select", options: companyOptions },
    { key: "source", label: "Source", type: "select", options: sourceOptions },
    { key: "status", label: "Status", type: "select", options: ["Active", "Lead", "Inactive"] },
    { key: "tags", label: "Tags", wide: true }, { key: "lastContacted", label: "Last contacted", type: "date" },
    { key: "nextFollowUp", label: "Next follow-up", type: "date" }, { key: "notes", label: "Notes", type: "textarea", wide: true },
  ];
  if (kind === "company") return [
    { key: "name", label: "Company name", required: true }, { key: "website", label: "Website" },
    { key: "industry", label: "Industry" }, { key: "size", label: "Company size", type: "select", options: choices(["Select size", "1–10", "11–50", "51–200", "201–500", "501–1,000", "1,000+"]) },
    { key: "location", label: "Location" }, { key: "status", label: "Status", type: "select", options: ["Active", "Prospect", "Inactive"] },
    { key: "tags", label: "Tags", wide: true }, { key: "description", label: "Description", type: "textarea", wide: true },
    { key: "notes", label: "Internal notes", type: "textarea", wide: true },
  ];
  if (kind === "job") return [
    { key: "title", label: "Job title", required: true }, { key: "referenceId", label: "Reference ID", required: true },
    { key: "companyId", label: "Company", type: "select", options: companyOptions }, { key: "contactId", label: "Contact", type: "select", options: contactOptions },
    { key: "opportunityId", label: "Related opportunity", type: "select", options: oppOptions }, { key: "category", label: "Category" },
    { key: "status", label: "Status", type: "select", options: data.jobStatuses }, { key: "priority", label: "Priority", type: "select", options: priorityOptions },
    { key: "owner", label: "Owner", type: "select", options: people }, { key: "startDate", label: "Start date", type: "date" },
    { key: "dueDate", label: "Due date", type: "date" }, { key: "completionDate", label: "Completion date", type: "date" },
    { key: "nextAction", label: "Next action", wide: true }, { key: "description", label: "Description", type: "textarea", wide: true },
    { key: "notes", label: "Internal notes", type: "textarea", wide: true },
  ];
  if (kind === "opportunity") return [
    { key: "title", label: "Opportunity title", required: true }, { key: "companyId", label: "Company", type: "select", options: companyOptions },
    { key: "contactId", label: "Primary contact", type: "select", options: contactOptions }, { key: "jobId", label: "Related job", type: "select", options: jobOptions },
    { key: "source", label: "Source", type: "select", options: sourceOptions }, { key: "category", label: "Category" },
    { key: "stage", label: "Stage", type: "select", options: data.pipelineStages }, { key: "priority", label: "Priority", type: "select", options: priorityOptions },
    { key: "owner", label: "Owner", type: "select", options: people }, { key: "estimatedValue", label: "Estimated value (NGN)", type: "number" },
    { key: "confidence", label: "Confidence (%)", type: "number" }, { key: "expectedDecisionDate", label: "Expected decision", type: "date" },
    { key: "nextFollowUp", label: "Next follow-up", type: "date" }, { key: "nextAction", label: "Next action", wide: true },
    { key: "lossReason", label: "Loss reason (optional)", wide: true }, { key: "description", label: "Description", type: "textarea", wide: true },
    { key: "notes", label: "Internal notes", type: "textarea", wide: true },
  ];
  const recordOptions = taskType === "company" ? companyOptions : taskType === "job" ? jobOptions : taskType === "contact" ? contactOptions : oppOptions;
  const recordLabels = taskType === "company" ? ["No linked record", ...data.companies.map((item) => item.name)] : taskType === "job" ? ["No linked record", ...data.jobs.map((item) => item.title)] : taskType === "contact" ? ["No linked record", ...data.contacts.map((item) => fullName(item))] : ["No linked record", ...data.opportunities.map((item) => item.title)];
  return [
    { key: "title", label: "Task title", required: true }, { key: "type", label: "Task type", type: "select", options: ["Call", "Email", "Meeting", "Follow-up", "Research", "Job-related task", "General task"] },
    { key: "recordType", label: "Related record type", type: "select", options: ["opportunity", "contact", "company", "job"] },
    { key: "recordId", label: "Related record", type: "select", options: recordOptions, optionLabels: recordLabels } as any,
    { key: "owner", label: "Owner", type: "select", options: people }, { key: "priority", label: "Priority", type: "select", options: priorityOptions },
    { key: "dueDate", label: "Due date & time", type: "datetime-local", required: true }, { key: "status", label: "Status", type: "select", options: ["To Do", "In Progress", "Completed", "Cancelled"] },
    { key: "description", label: "Description", type: "textarea", wide: true }, { key: "notes", label: "Notes", type: "textarea", wide: true },
  ];
}

function RecordDialog({ kind, record, data, onClose, onSave }: { kind: Kind; record?: any; data: CrmData; onClose: () => void; onSave: (form: Record<string, string>) => boolean }) {
  const [form, setForm] = useState<Record<string, string>>(() => ({
    owner: "You", status: kind === "task" ? "To Do" : kind === "job" ? "New" : kind === "opportunity" ? data.pipelineStages[0] : kind === "company" ? "Active" : "Lead",
    priority: "Medium", source: "Referral", type: "Follow-up", recordType: "opportunity",
    ...(kind === "contact" ? { companyName: data.companies.find((company) => company.id === record?.companyId)?.name || "" } : {}),
    ...record,
  }));
  const fields = fieldsFor(kind, data, form.recordType).map((field) =>
    kind === "contact" && field.key === "companyId"
      ? { ...field, key: "companyName", type: "text", options: undefined, placeholder: "Enter company name" }
      : field);
  const setValue = (key: string, value: string) => setForm((old) => key === "recordType" ? { ...old, recordType: value, recordId: "" } : { ...old, [key]: value });
  const optionLabel = (field: Field, value: string) => {
    if (!value) return field.key === "companyId" ? "No company" : field.key === "contactId" ? "No contact" : "None";
    if (field.key === "companyId") return data.companies.find((item) => item.id === value)?.name || value;
    if (field.key === "contactId") return fullName(data.contacts.find((item) => item.id === value));
    if (field.key === "opportunityId") return data.opportunities.find((item) => item.id === value)?.title || value;
    if (field.key === "jobId") return data.jobs.find((item) => item.id === value)?.title || value;
    if (field.key === "recordId") {
      const key = form.recordType === "company" ? "companies" : form.recordType === "job" ? "jobs" : form.recordType === "contact" ? "contacts" : "opportunities";
      const item = (data[key] as any[]).find((entry) => entry.id === value);
      return item ? (item.firstName ? fullName(item) : item.name || item.title) : "None";
    }
    return value;
  };
  return <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="form-modal" role="dialog" aria-modal="true" aria-labelledby="form-title"><div className="modal-header"><div><span className="modal-kicker">{record ? "EDIT RECORD" : "NEW RECORD"}</span><h2 id="form-title">{record ? "Edit " : "Create "}{kindLabel[kind].toLowerCase()}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); onSave(form); }}><div className="form-grid">{fields.map((field) => <label key={field.key} className={"field-label " + (field.wide ? "wide" : "")}>{field.label}{field.type === "textarea" ? <textarea className="form-input" rows={3} value={form[field.key] || ""} required={field.required} onChange={(e) => setValue(field.key, e.target.value)} /> : field.type === "select" ? <select className="form-input" value={form[field.key] || ""} required={field.required} onChange={(e) => setValue(field.key, e.target.value)}>{(field.options || []).map((option, index) => <option key={option || "empty-" + index} value={option}>{field.key === "recordId" ? ((field as any).optionLabels?.[index] || optionLabel(field, option)) : option ? optionLabel(field, option) : "Select..."}</option>)}</select> : <input className="form-input" type={field.type || "text"} value={form[field.key] || ""} placeholder={field.placeholder} required={field.required} min={field.type === "number" ? 0 : undefined} max={field.key === "confidence" ? 100 : undefined} onChange={(e) => setValue(field.key, e.target.value)} />}</label>)}</div>
    {kind === "opportunity" && form.stage === "Won" && <div className="form-hint success-hint"><Icon name="spark" size={15} />Once saved, you can create a related job from the opportunity details.</div>}
    {kind === "opportunity" && form.stage === "Lost" && <div className="form-hint"><Icon name="note" size={15} />A loss reason is optional and will stay with this opportunity.</div>}
    <div className="modal-footer"><span className="form-footnote">Changes save in this browser.</span><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{record ? "Save changes" : "Create " + kindLabel[kind].toLowerCase()}</button></div></form>
  </section></div>;
}

function DetailPanel({ kind, record, data, senderName, notes, activities, getRecordLabel, onClose, onEdit, onArchive, onRestore, onNote, noteText, setNoteText, onOpen, onStage, onCreateJob, onTaskStatus }: { kind: Kind; record: any; data: CrmData; senderName: string; notes: CrmNote[]; activities: Activity[]; getRecordLabel: (kind: Kind, id: string) => string; onClose: () => void; onEdit: () => void; onArchive: () => void; onRestore: () => void; onNote: () => void; noteText: string; setNoteText: (value: string) => void; onOpen: (kind: Kind, id: string) => void; onStage: (stage: string) => void; onCreateJob: () => void; onTaskStatus: (status: string) => void }) {
  const [outreachMessages, setOutreachMessages] = useState<OutreachMessage[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<OutreachMessage | null>(null);
  const [showAllConversations, setShowAllConversations] = useState(false);
  useEffect(() => {
    let alive = true;
    if (kind === "contact" || kind === "opportunity") {
      getOutreachMessages().then((items) => { if (alive) setOutreachMessages(items); }).catch(() => { if (alive) setOutreachMessages([]); });
    } else setOutreachMessages([]);
    return () => { alive = false; };
  }, [kind, record.id]);
  const recordOutreach = outreachMessages.filter((item) => kind === "contact" ? item.contactId === record.id : item.opportunityId === record.id);
  const company = data.companies.find((item) => item.id === record.companyId);
  const contact = data.contacts.find((item) => item.id === record.contactId);
  const related = kind === "contact" ? [
    ...data.jobs.filter((item) => item.contactId === record.id).map((item) => ({ kind: "job" as Kind, id: item.id, title: item.title, meta: item.status })),
    ...data.opportunities.filter((item) => item.contactId === record.id).map((item) => ({ kind: "opportunity" as Kind, id: item.id, title: item.title, meta: item.stage })),
  ] : kind === "company" ? [
    ...data.contacts.filter((item) => item.companyId === record.id).map((item) => ({ kind: "contact" as Kind, id: item.id, title: fullName(item), meta: item.jobTitle })),
    ...data.jobs.filter((item) => item.companyId === record.id).map((item) => ({ kind: "job" as Kind, id: item.id, title: item.title, meta: item.status })),
    ...data.opportunities.filter((item) => item.companyId === record.id).map((item) => ({ kind: "opportunity" as Kind, id: item.id, title: item.title, meta: item.stage })),
  ] : kind === "job" ? [
    ...(record.companyId ? [{ kind: "company" as Kind, id: record.companyId, title: company?.name || "Company", meta: "Company" }] : []),
    ...(record.contactId ? [{ kind: "contact" as Kind, id: record.contactId, title: fullName(contact), meta: "Primary contact" }] : []),
    ...(record.opportunityId ? [{ kind: "opportunity" as Kind, id: record.opportunityId, title: data.opportunities.find((item) => item.id === record.opportunityId)?.title || "Opportunity", meta: "Related opportunity" }] : []),
  ] : kind === "opportunity" ? [
    ...(record.companyId ? [{ kind: "company" as Kind, id: record.companyId, title: company?.name || "Company", meta: "Company" }] : []),
    ...(record.contactId ? [{ kind: "contact" as Kind, id: record.contactId, title: fullName(contact), meta: "Primary contact" }] : []),
    ...(record.jobId ? [{ kind: "job" as Kind, id: record.jobId, title: data.jobs.find((item) => item.id === record.jobId)?.title || "Related job", meta: "Related job" }] : []),
  ] : [];
  const title = kind === "contact" ? fullName(record) : kind === "company" ? record.name : record.title;
  const subtitle = kind === "contact" ? [record.jobTitle, company?.name].filter(Boolean).join(" · ") : kind === "company" ? [record.industry, record.location].filter(Boolean).join(" · ") : kind === "job" ? record.referenceId + (company ? " · " + company.name : "") : kind === "opportunity" ? [company?.name, record.category].filter(Boolean).join(" · ") : record.type + (record.owner ? " · " + record.owner : "");
  const contactWebsite = record.website || company?.website || Object.entries(record.customFields || {}).find(([key, value]) => /^(company )?website$/i.test(key) && typeof value === "string")?.[1] || "";
  const displayFields: [string, any][] = kind === "contact" ? [["Email", record.email], ["Phone", record.phone], ["Company website", contactWebsite], ["Country / region", record.country], ["Preferred language", record.preferredLanguage], ["Source", record.source], ["Status", record.status], ["Last contacted", fmtDate(record.lastContacted)], ["Next follow-up", fmtDate(record.nextFollowUp)], ["Tags", record.tags]]
    : kind === "company" ? [["Website", record.website], ["Industry", record.industry], ["Company size", record.size], ["Location", record.location], ["Status", record.status], ["Tags", record.tags]]
      : kind === "job" ? [["Status", record.status], ["Priority", record.priority], ["Owner", record.owner], ["Start date", fmtDate(record.startDate)], ["Due date", fmtDate(record.dueDate)], ["Completion date", fmtDate(record.completionDate)], ["Category", record.category], ["Next action", record.nextAction]]
        : kind === "opportunity" ? [["Stage", record.stage], ["Priority", record.priority], ["Owner", record.owner], ["Estimated value", record.estimatedValue ? new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(record.estimatedValue)) + " · estimate" : "Not set"], ["Confidence", record.confidence ? record.confidence + "%" : "Not set"], ["Expected decision", fmtDate(record.expectedDecisionDate)], ["Next follow-up", fmtDate(record.nextFollowUp)], ["Next action", record.nextAction], ["Loss reason", record.lossReason]]
          : [["Type", record.type], ["Status", record.status], ["Priority", record.priority], ["Owner", record.owner], ["Due", fmtDate(record.dueDate) + (fmtTime(record.dueDate) ? " · " + fmtTime(record.dueDate) : "")], ["Completed", fmtDate(record.completedAt)]];
  const importedFields: [string, string][] = ["contact", "company"].includes(kind)
    ? Object.entries(record.customFields || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string").sort(([left], [right]) => left.localeCompare(right))
    : [];
  const internalNotes = record.notes || record.description || "";
  const recordTasks = kind === "task" ? [] : data.tasks.filter((task) => task.recordType === kind && task.recordId === record.id);
  return <div className="detail-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="detail-panel" role="dialog" aria-modal="true"><div className="detail-topbar"><span className="modal-kicker">{kindLabel[kind].toUpperCase()} PROFILE</span><div><button className="icon-button" aria-label="Edit record" onClick={onEdit}><Icon name="note" size={17} /></button><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div></div>
    <div className="detail-hero"><div className={"detail-avatar " + kind}>{kind === "contact" ? initials(title) : <Icon name={kind === "company" ? "building" : kind === "job" ? "briefcase" : kind === "opportunity" ? "target" : "check"} size={21} />}</div><div className="detail-title-wrap"><h2>{title}</h2><p>{subtitle || kindLabel[kind]}</p></div></div>
    <div className="detail-actions"><button className="button button-primary" onClick={onEdit}><Icon name="note" size={15} />Edit {kindLabel[kind].toLowerCase()}</button>{kind !== "task" && (record.archived ? <button className="button button-secondary" onClick={onRestore}>Restore from archive</button> : <button className="button button-secondary" onClick={onArchive}>Archive</button>)}</div>
    {kind === "opportunity" && <div className="stage-control"><label>Current stage<select className="form-input" value={record.stage} onChange={(e) => onStage(e.target.value)}>{data.pipelineStages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>{record.stage === "Won" && <div className="job-convert"><div><strong>{record.jobId ? "Related job created" : "Ready to start the work?"}</strong><small>{record.jobId ? "This opportunity is linked to a job." : "Create one job with the company, contact, and scope already attached."}</small></div>{record.jobId ? <button className="button button-secondary" onClick={() => onOpen("job", record.jobId)}>Open job</button> : <button className="button button-primary" onClick={onCreateJob}>Create related job</button>}</div>}</div>}
    {kind === "task" && record.status !== "Completed" && record.status !== "Cancelled" && <button className="complete-task-button" onClick={() => onTaskStatus("Completed")}><span>✓</span>Mark task complete</button>}
    <div className="detail-scroll">
      <section className="detail-section"><h3>Details</h3><div className="detail-fields">{[...displayFields, ...importedFields].filter(([, value]) => value && value !== "—").map(([label, value]) => <div className="detail-field" key={label}><small>{label}</small><span>{label === "Status" || label === "Stage" ? <StatusBadge value={String(value)} /> : label === "Priority" ? <PriorityBadge value={String(value)} /> : label.toLowerCase().includes("website") && websiteHref(String(value)) ? <a href={websiteHref(String(value))} target="_blank" rel="noopener noreferrer">{String(value)}</a> : String(value)}</span></div>)}</div>{internalNotes && <div className="detail-description"><small>{kind === "contact" || kind === "company" ? "Notes" : "Description / notes"}</small><p>{internalNotes}</p></div>}</section>
      {!!related.length && <section className="detail-section"><div className="detail-section-heading"><h3>Related records</h3><span>{related.length}</span></div><div className="related-list">{related.map((item) => <button key={item.kind + item.id} onClick={() => onOpen(item.kind, item.id)}><span className="relation-icon"><Icon name={item.kind === "company" ? "building" : item.kind === "contact" ? "users" : item.kind === "job" ? "briefcase" : "target"} size={15} /></span><strong>{item.title}</strong><small>{item.meta}</small><Icon name="chevron" size={15} /></button>)}</div></section>}
      {kind === "opportunity" && <section className="detail-section"><h3>Stage history</h3><div className="stage-history">{(record.stageHistory || []).slice().reverse().map((entry: any, index: number) => <div key={entry.stage + entry.date + index} className="history-entry"><span className="history-dot" /><div><strong>{entry.stage}</strong><small>{fmtDate(entry.date)}</small></div></div>)}</div></section>}
      {!!recordTasks.length && <section className="detail-section"><div className="detail-section-heading"><h3>Tasks & follow-ups</h3><span>{recordTasks.length}</span></div><div className="related-list">{recordTasks.map((task) => <button key={task.id} onClick={() => onOpen("task", task.id)}><span className="relation-icon"><Icon name="check" size={15} /></span><strong>{task.title}</strong><small>{fmtDate(task.dueDate)}</small><StatusBadge value={task.status} /></button>)}</div></section>}
      {(kind === "contact" || kind === "opportunity") && <section className="detail-section"><div className="detail-section-heading"><h3>Outreach emails</h3><div className="outreach-history-heading-actions"><span>{recordOutreach.length}</span>{recordOutreach.length > 0 && <button className="button button-secondary view-all-conversations" onClick={() => setShowAllConversations(true)}>View all</button>}</div></div>{recordOutreach.length ? <div className="outreach-history-list">{recordOutreach.slice(0, 8).map((item) => <article key={item.id}><div><button className="outreach-subject-button" onClick={() => setSelectedEmail(item)}>{item.subject}</button><small>{fmtDate(item.sentAt)} · {item.clickCount} link clicks</small></div><span className={"outreach-status " + item.status}>{item.status === "replied" ? "Replied" : item.status === "failed" ? "Failed" : item.status === "sending" ? "Sending" : "Sent"}</span>{item.gmailThreadUrl && <a href={item.gmailThreadUrl} target="_blank" rel="noreferrer">Open in Gmail ↗</a>}</article>)}</div> : <div className="detail-muted">No outreach emails are linked to this record yet.</div>}</section>}
      <section className="detail-section"><h3>Notes</h3><div className="add-note-box"><textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add an internal note..." rows={3} /><button className="button button-primary" disabled={!noteText.trim()} onClick={onNote}>Add note</button></div>{notes.length ? <div className="note-list">{notes.map((note) => <article key={note.id}><p>{note.body}</p><small>{note.author} · {fmtDate(note.createdAt)} at {fmtTime(note.createdAt)}</small></article>)}</div> : <div className="detail-muted">No notes added yet.</div>}</section>
      <section className="detail-section"><h3>Activity</h3><ActivityList items={activities.slice(0, 8)} onClick={() => {}} getRecordLabel={getRecordLabel} interactive={false} /></section>
      <div className="record-meta">Created {fmtDate(record.createdAt)} · Updated {fmtDate(record.updatedAt)}</div>
    </div>
    {showAllConversations && <OutreachConversationsDialog title={title} messages={recordOutreach} senderName={senderName} onClose={() => setShowAllConversations(false)} />}
    {selectedEmail && <OutreachThreadDialog message={selectedEmail} senderName={senderName} onReplySent={(sentReply) => setOutreachMessages((current) => [sentReply, ...current.filter((item) => item.id !== sentReply.id)])} onClose={() => setSelectedEmail(null)} />}
    </aside></div>;
}

export default App;
