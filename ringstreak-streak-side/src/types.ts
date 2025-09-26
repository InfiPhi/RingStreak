export interface StreakPerson {
  key: string;
  name?: string;
  email?: string;
  phone?: string | string[];
  phones?: string[];
  organization?: string;
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

export interface MatchResult {
  score: number;
  contact: StreakPerson;
  box?: StreakBox;
  links: { openBox?: string; openPerson?: string };
}

export interface LookupResponse {
  query: string;
  normalized: string | null;
  matches: MatchResult[];
}
