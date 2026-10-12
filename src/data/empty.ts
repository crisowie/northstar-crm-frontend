import type { CrmData } from "../types";

export function emptyWorkspace(): CrmData {
  return {
    organization: "My workspace",
    pipelineStages: ["Lead Identified", "Qualified", "Discovery", "Proposal", "Negotiation", "Won", "Lost"],
    jobStatuses: ["New", "Planned", "In Progress", "On Hold", "Completed", "Cancelled"],
    contacts: [],
    companies: [],
    jobs: [],
    opportunities: [],
    tasks: [],
    notes: [],
    activities: [],
  };
}
