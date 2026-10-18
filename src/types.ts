export type ContactStatus = "Active" | "Lead" | "Inactive";
export type CompanyStatus = "Active" | "Prospect" | "Contacted" | "Inactive";
export type JobStatus = "New" | "Planned" | "In Progress" | "On Hold" | "Completed" | "Cancelled";
export type OpportunityStage = string;
export type TaskStatus = "To Do" | "In Progress" | "Completed" | "Cancelled";
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  website?: string;
  country?: string;
  preferredLanguage?: string;
  jobTitle: string;
  companyId: string;
  source: string;
  tags: string;
  status: ContactStatus;
  notes: string;
  lastContacted: string;
  nextFollowUp: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  customFields?: Record<string, string>;
}
export interface Company {
  id: string;
  name: string;
  website: string;
  industry: string;
  size: string;
  location: string;
  description: string;
  status: CompanyStatus;
  tags: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  customFields?: Record<string, string>;
}
export interface Job {
  id: string;
  title: string;
  referenceId: string;
  description: string;
  companyId: string;
  contactId: string;
  opportunityId: string;
  category: string;
  status: JobStatus;
  priority: Priority;
  owner: string;
  startDate: string;
  dueDate: string;
  completionDate: string;
  nextAction: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}
export interface Opportunity {
  id: string;
  title: string;
  description: string;
  companyId: string;
  contactId: string;
  jobId: string;
  source: string;
  category: string;
  stage: OpportunityStage;
  priority: Priority;
  owner: string;
  estimatedValue: string;
  confidence: string;
  expectedDecisionDate: string;
  nextAction: string;
  nextFollowUp: string;
  lossReason: string;
  notes: string;
  stageHistory: { stage: string; date: string }[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}
export interface CrmTask {
  id: string;
  title: string;
  description: string;
  type: string;
  recordType: string;
  recordId: string;
  owner: string;
  priority: Priority;
  dueDate: string;
  status: TaskStatus;
  completedAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface CrmNote {
  id: string;
  recordType: string;
  recordId: string;
  body: string;
  author: string;
  createdAt: string;
}
export interface Activity {
  id: string;
  type: string;
  title: string;
  detail: string;
  recordType: string;
  recordId: string;
  user: string;
  createdAt: string;
}
export interface CrmData {
  contacts: Contact[];
  companies: Company[];
  jobs: Job[];
  opportunities: Opportunity[];
  tasks: CrmTask[];
  notes: CrmNote[];
  activities: Activity[];
  pipelineStages: string[];
  jobStatuses: string[];
  organization: string;
}

export interface CrmAnalytics {
  date: string;
  totalContacts: number;
  totalCompanies: number;
  activeJobs: number;
  openOpportunities: number;
  needsAttention: number;
  tasksDueToday: number;
  overdueFollowUps: number;
  wonLast30Days: number;
  totalWon: number;
  totalLost: number;
  openOpportunityValue: number;
  pipeline: { stage: string; count: number; value: number }[];
}
