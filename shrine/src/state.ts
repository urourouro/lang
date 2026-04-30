import { nanoid } from "nanoid";

export interface Visit {
  id: string;
  agentName: string;
  arrivedAt: number;
  words: string[];
  status: "present" | "departed";
  departedAt?: number;
}

const visits = new Map<string, Visit>();

export function createVisit(agentName: string): Visit {
  const visit: Visit = {
    id: nanoid(),
    agentName,
    arrivedAt: Date.now(),
    words: [],
    status: "present",
  };
  visits.set(visit.id, visit);
  return visit;
}

export function getVisit(id: string): Visit | undefined {
  return visits.get(id);
}

export function addWord(visitId: string, word: string): void {
  visits.get(visitId)?.words.push(word);
}

export function departVisit(visitId: string): Visit | undefined {
  const visit = visits.get(visitId);
  if (!visit) return undefined;
  visit.status = "departed";
  visit.departedAt = Date.now();
  return visit;
}

export function getAllVisits(): Visit[] {
  return Array.from(visits.values());
}
