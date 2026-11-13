import { quoteStrict, shortName } from "./common.js";

export interface BuildLinksOptions {
  goodjobName?: string | null;
  qollieId?: string | null;
  itwShortId?: string | null;
}

export interface CompanyLinks {
  goodjob: string;
  qollie: string;
  interview_tw: string;
  salary_tw: string;
  dcard: string;
  ptt: string;
}

export function build(name: string, options: BuildLinksOptions = {}): CompanyLinks {
  const short = shortName(name);
  const q = quoteStrict(short);
  const { goodjobName, qollieId, itwShortId } = options;
  return {
    goodjob: "https://www.goodjob.life/companies/" + quoteStrict(goodjobName || name),
    qollie: qollieId
      ? `https://www.qollie.com/companies/${qollieId}`
      : `https://www.qollie.com/search?keyword=${q}`,
    interview_tw: itwShortId
      ? `https://interview.tw/c/${itwShortId}`
      : `https://interview.tw/search?keyword=${q}`,
    salary_tw: itwShortId
      ? `https://salary.tw/c/${itwShortId}`
      : "https://www.google.com/search?q=" + quoteStrict(`${short} site:salary.tw`),
    dcard: `https://www.dcard.tw/search?query=${q}&forum=job`,
    ptt: "https://www.google.com/search?q=" + quoteStrict(`${short} site:ptt.cc`),
  };
}
