export interface StreakPerson {
  key: string;
  name?: string;
  email?: string;
  phone?: string | string[];
  organization?: string;
  // TODO: confirm where custom fields live on People
  fields?: Record<string, any>;
  [k: string]: any;
}

export interface StreakBox {
  key: string;
  name?: string;
  pipelineKey?: string;
  stageKey?: string;
  lastUpdatedTimestamp?: number;
  [k: string]: any;
}

// TODO: expand with other useful fields from Streak API
export interface MatchResult {
  score: number;
  contact: StreakPerson;
  box?: StreakBox;
}

export interface LookupResponse {
  query: string;
  normalized: string | null;
  matches: MatchResult[];
}
