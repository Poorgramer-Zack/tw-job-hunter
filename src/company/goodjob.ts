import { clip, NOTICE, quoteStrict } from "./common.js";
import { graphql, SourceError } from "./http.js";

export const SOURCE = "GoodJob";
export const URL = "https://api.goodjob.life/graphql";
export const HEADERS: Record<string, string> = { "Content-Type": "application/json" };

const STATS = `
 id name businessNumber dataCount experienceCount salaryWorkTimeCount
 salary_work_time_statistics{count average_week_work_time average_estimated_hourly_wage
  overtime_frequency_count{seldom sometimes usually almost_everyday}
  has_overtime_salary_count{yes no unknown} is_overtime_salary_legal_count{yes no unknown} has_compensatory_dayoff_count{yes no unknown}}
 companyRatingStatistics{averageRating ratingCount ratingDistribution{rating count}}
 companyAspectRatingStatistics{aspect averageRating ratingCount}
 topNJobTitles{all{name}}`;

const REVIEWS = `
 interviewExperiencesResult(start:0,limit:$n){count interviewExperiences{id job_title{name} region experience_in_year interview_time{year month} interview_result created_at averageSectionRating sections{subtitle content}}}
 workExperiencesResult(start:0,limit:$n){count workExperiences{id job_title{name} region experience_in_year data_time{year month} week_work_time recommend_to_others created_at averageSectionRating sections{subtitle content}}}`;

function buildQuery(includeReviews: boolean): string {
  const decl = "$q:String!" + (includeReviews ? ",$n:Int!" : "");
  return `query(${decl}){search_companies(query:$q,hasData:false,limit:5){${STATS}${includeReviews ? REVIEWS : ""}}}`;
}

function ym(d: { year?: number; month?: number } | null | undefined): string | null {
  if (!d || !d.year || !d.month) {
    return null;
  }
  return `${d.year}-${String(Number(d.month)).padStart(2, "0")}`;
}

interface RawSection {
  subtitle?: string | null;
  content?: string | null;
}

interface RawExperience {
  id: string;
  job_title?: { name?: string | null } | null;
  region?: string | null;
  experience_in_year?: number | null;
  created_at?: string | null;
  averageSectionRating?: number | null;
  sections?: RawSection[] | null;
  interview_time?: { year?: number; month?: number } | null;
  interview_result?: string | null;
  data_time?: { year?: number; month?: number } | null;
  week_work_time?: number | null;
  recommend_to_others?: string | null;
}

function mapSections(e: RawExperience) {
  return (e.sections ?? []).map((s) => ({
    title: s.subtitle ?? null,
    content: clip(s.content ?? null),
  }));
}

function mapCommon(e: RawExperience) {
  return {
    source: "goodjob" as const,
    url: `https://www.goodjob.life/experiences/${e.id}`,
    job_title: e.job_title?.name ?? null,
    region: e.region ?? null,
    experience_years: e.experience_in_year ?? null,
    posted: (e.created_at ?? "").slice(0, 10) || null,
    rating: e.averageSectionRating ?? null,
    sections: mapSections(e),
  };
}

function mapInterview(e: RawExperience) {
  return {
    ...mapCommon(e),
    interview_date: ym(e.interview_time),
    result: e.interview_result ?? null,
  };
}

function mapWork(e: RawExperience) {
  return {
    ...mapCommon(e),
    work_date: ym(e.data_time),
    week_work_time: e.week_work_time ?? null,
    recommend: e.recommend_to_others ?? null,
  };
}

export interface GoodJobOptions {
  includeReviews?: boolean;
  reviewLimit?: number;
}

export interface GoodJobData {
  tax_id: string;
  name: string | null;
  url: string;
  data_count: number | null;
  experience_count: number | null;
  salary_work_time_count: number | null;
  rating: { average: number; count: number; distribution: unknown } | null;
  aspect_ratings: Array<{ aspect: string; average: number; count: number }>;
  avg_week_work_time: number | null;
  avg_hourly_wage: number | null;
  overtime_frequency: Record<string, number> | null;
  has_overtime_pay: Record<string, number> | null;
  has_compensatory_dayoff: Record<string, number> | null;
  top_job_titles: string[];
}

export interface GoodJobReviews {
  notice: string;
  interview_total: number | null;
  work_total: number | null;
  interviews: ReturnType<typeof mapInterview>[];
  work: ReturnType<typeof mapWork>[];
}

export type GoodJobResult =
  | { status: "not_found" }
  | { status: "ok"; data: GoodJobData; reviews?: GoodJobReviews };

export async function get(
  taxId: string,
  options: GoodJobOptions = {},
): Promise<GoodJobResult> {
  const includeReviews = options.includeReviews ?? true;
  const reviewLimit = options.reviewLimit ?? 20;
  const variables: Record<string, unknown> = { q: taxId };
  if (includeReviews) {
    variables.n = reviewLimit;
  }

  const companies = await graphql<Array<Record<string, any>> | null>(
    SOURCE,
    URL,
    buildQuery(includeReviews),
    variables,
    "search_companies",
    HEADERS,
  );
  if (companies === null || companies === undefined) {
    throw new SourceError("schema", "GoodJob 的 search_companies 為空，格式可能已改變");
  }

  const hits = companies.filter((c) => c.businessNumber === taxId);
  if (hits.length === 0) {
    return { status: "not_found" };
  }

  const c = hits[0];
  const st = c.salary_work_time_statistics ?? {};
  const rt = c.companyRatingStatistics;
  const out: GoodJobResult = {
    status: "ok",
    data: {
      tax_id: taxId,
      name: c.name ?? null,
      url: "https://www.goodjob.life/companies/" + quoteStrict(c.name ?? ""),
      data_count: c.dataCount ?? null,
      experience_count: c.experienceCount ?? null,
      salary_work_time_count: c.salaryWorkTimeCount ?? null,
      rating: rt
        ? {
            average: rt.averageRating,
            count: rt.ratingCount,
            distribution: rt.ratingDistribution ?? null,
          }
        : null,
      aspect_ratings: (c.companyAspectRatingStatistics ?? []).map((a: any) => ({
        aspect: a.aspect,
        average: a.averageRating,
        count: a.ratingCount,
      })),
      avg_week_work_time: st.average_week_work_time ?? null,
      avg_hourly_wage: st.average_estimated_hourly_wage ?? null,
      overtime_frequency: st.overtime_frequency_count ?? null,
      has_overtime_pay: st.has_overtime_salary_count ?? null,
      has_compensatory_dayoff: st.has_compensatory_dayoff_count ?? null,
      top_job_titles: (c.topNJobTitles?.all ?? []).map((t: any) => t.name),
    },
  };

  if (includeReviews) {
    const iv = c.interviewExperiencesResult ?? {};
    const wk = c.workExperiencesResult ?? {};
    out.reviews = {
      notice: NOTICE,
      interview_total: iv.count ?? null,
      work_total: wk.count ?? null,
      interviews: (iv.interviewExperiences ?? []).slice(0, reviewLimit).map(mapInterview),
      work: (wk.workExperiences ?? []).slice(0, reviewLimit).map(mapWork),
    };
  }

  return out;
}
