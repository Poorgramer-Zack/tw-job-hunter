import { COMPANY_SUFFIXES } from "./common.js";
import { request } from "./http.js";

export const SOURCE = "經濟部商工 API";
export const BASE = "https://data.gcis.nat.gov.tw/od/data/api/";
export const TAXID_API = "5F64D864-61CB-4D0D-8AD9-492047CC1EA6";
export const NAME_API = "6BBA2268-1367-4B42-9CCA-BC17499EBE8C";
export const STATUS_APPROVED = "01";
export const MAX_CANDIDATES = 10;
export const FULL_NAME_TAILS: readonly string[] = [...COMPANY_SUFFIXES, "公司"];

interface GcisRow {
  Business_Accounting_NO: string;
  Company_Name: string;
  Company_Status?: string;
  Company_Status_Desc?: string;
  Capital_Stock_Amount?: number;
  Paid_In_Capital_Amount?: number;
  Responsible_Name?: string;
  Company_Location?: string;
  Company_Setup_Date?: string;
}

export interface CompanyData {
  tax_id: string | undefined;
  name: string | undefined;
  status: string | undefined;
  capital: number | undefined;
  paid_in_capital: number | undefined;
  responsible: string | null;
  address: string | undefined;
  setup_date: string | null;
  years_since_setup: number | null;
}

export type GetByTaxIdResult =
  | { status: "ok"; data: CompanyData }
  | { status: "not_found" };

export interface Candidate {
  tax_id: string;
  name: string;
  status: string | undefined;
  address: string | undefined;
}

export type ResolveNameResult =
  | { status: "ok"; tax_id: string; name: string }
  | { status: "not_found"; message: string }
  | { status: "needs_selection"; candidates: Candidate[] };

async function queryApi(apiId: string, flt: string): Promise<GcisRow[]> {
  const rows = await request<GcisRow[] | null>(SOURCE, "GET", BASE + apiId, {
    params: { $format: "json", $filter: flt, $skip: 0, $top: 50 },
    allowEmpty: true,
  });
  return rows ?? [];
}

export function rocToIso(s: string | null | undefined): string | null {
  if (!s || !/^\d{7}$/.test(s)) {
    return null;
  }
  return `${Number(s.slice(0, 3)) + 1911}-${s.slice(3, 5)}-${s.slice(5, 7)}`;
}

export function yearsSince(iso: string | null | undefined, today: Date): number | null {
  if (!iso) {
    return null;
  }
  const [y, m, d] = iso.split("-").map(Number);
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  const before = tm < m || (tm === m && td < d) ? 1 : 0;
  return ty - y - before;
}

export async function getByTaxId(taxId: string, today?: Date): Promise<GetByTaxIdResult> {
  if (!/^\d{8}$/.test(taxId ?? "")) {
    throw new Error(`統一編號必須是 8 碼數字，收到「${taxId}」`);
  }
  const rows = await queryApi(TAXID_API, `Business_Accounting_NO eq ${taxId}`);
  if (rows.length === 0) {
    return { status: "not_found" };
  }
  const r = rows[0];
  const setup = rocToIso(r.Company_Setup_Date);
  return {
    status: "ok",
    data: {
      tax_id: r.Business_Accounting_NO,
      name: r.Company_Name,
      status: r.Company_Status_Desc,
      capital: r.Capital_Stock_Amount,
      paid_in_capital: r.Paid_In_Capital_Amount,
      responsible: r.Responsible_Name || null,
      address: r.Company_Location,
      setup_date: setup,
      years_since_setup: yearsSince(setup, today ?? new Date()),
    },
  };
}

function norm(s: string): string {
  return s.trim().replaceAll("臺", "台");
}

function isFullName(query: string, company: string): boolean {
  return company.startsWith(query) && FULL_NAME_TAILS.includes(company.slice(query.length));
}

export async function resolveName(name: string): Promise<ResolveNameResult> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    throw new Error("公司名稱不可為空");
  }
  const variants = new Set([
    trimmed,
    trimmed.replaceAll("臺", "台"),
    trimmed.replaceAll("台", "臺"),
  ]);
  const q = norm(trimmed);
  const rows = new Map<string, GcisRow>();
  for (const v of variants) {
    const found = await queryApi(NAME_API, `Company_Name like ${v} and Company_Status eq ${STATUS_APPROVED}`);
    for (const r of found) {
      if (!rows.has(r.Business_Accounting_NO)) {
        rows.set(r.Business_Accounting_NO, r);
      }
    }
    let hasExact = false;
    for (const r of rows.values()) {
      if (norm(r.Company_Name) === q) {
        hasExact = true;
        break;
      }
    }
    if (hasExact) {
      break;
    }
  }

  if (rows.size === 0) {
    return { status: "not_found", message: `查無「${trimmed}」；簡稱請改用公司全名或統編` };
  }

  const allRows = Array.from(rows.values());
  const exact = allRows.filter((r) => norm(r.Company_Name) === q);
  const full = allRows.filter((r) => isFullName(q, norm(r.Company_Name)));
  const pick = exact.length > 0 ? exact[0] : full.length === 1 ? full[0] : null;
  if (pick) {
    return { status: "ok", tax_id: pick.Business_Accounting_NO, name: pick.Company_Name };
  }
  return {
    status: "needs_selection",
    candidates: allRows.slice(0, MAX_CANDIDATES).map((r) => ({
      tax_id: r.Business_Accounting_NO,
      name: r.Company_Name,
      status: r.Company_Status_Desc,
      address: r.Company_Location,
    })),
  };
}
