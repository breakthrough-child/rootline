// OFFLINE_MOCK corpus. Every page, person, organisation and domain here is FICTIONAL and uses the
// reserved `.example` TLD so it can never be mistaken for a real source. It exists so the full
// pipeline can run (and be tested) without API keys. It is never used when OFFLINE_MOCK is off.
import { relatedness, tokenOverlap } from "../text";
import type { ExtractedPage, SearchHit } from "../search";

interface MockPage {
  url: string;
  title: string;
  published: string | null; // what a search API would report
  content: string; // may itself contain a "Posted on …" date (page_metadata provenance)
}

export const MOCK_CORPUS: MockPage[] = [
  // ── Family A: "perfume sample" kidnapping scare ─────────────────────────────
  {
    url: "https://forum.nairatalk.example/t/strange-man-at-the-mall-48121",
    title: "Strange man at the mall - be careful",
    published: null,
    content:
      "Posted on 14 March 2017 by user tolu_b. Something strange happened to my sister at a filling station in Ibadan yesterday. A man walked up to her offering free perfume samples and asked her to smell it. She felt dizzy and quickly walked away. Please be careful when strangers ask you to smell anything. Reply from ade77: Thank God she is fine. Reply from mama_t: Na wa o.",
  },
  {
    url: "https://friendsbook.example/posts/ladies-be-careful-perfume-ibadan",
    title: "Ladies be careful!",
    published: "2018-06-02",
    content:
      "Ladies be careful! Men are offering free perfume samples at filling stations in Ibadan. They ask you to smell it and you feel dizzy, then they kidnap you. Please share. 412 shares.",
  },
  {
    url: "https://lagoslifestyle-blog.example/2019/09/beware-perfume-samples",
    title: "Beware of free perfume samples",
    published: "2019-09-20",
    content:
      "Lifestyle. Beware: Men are offering free perfume samples at filling stations in Lagos. They ask you to smell it and you faint, then they kidnap you. 200 women have gone missing. Please share with every woman you know. Comments (31).",
  },
  {
    url: "https://chirp.example/naija_alerts_fic/status/1324401",
    title: "naija alerts (fictional) on Chirp",
    published: "2020-11-05",
    content:
      "URGENT! Men are offering free perfume samples at filling stations in Lagos and Abuja. You smell it and you faint, then they kidnap you. 2,000 women missing this month. Police have confirmed. Forward to every woman you know before it's too late! 18.2K reposts 9,401 likes",
  },
  {
    url: "https://factline.example/fact-check/perfume-sample-kidnapping-claim",
    title: "Fact check: No evidence kidnappers are drugging women with perfume samples at filling stations",
    published: "2021-02-10",
    content:
      "Factline Desk (fictional fact-checking organisation). A message circulating on messaging apps claims: \"Men are offering free perfume samples at filling stations in Lagos and Abuja. You smell it and you faint, then they kidnap you. 2,000 women missing this month. Police have confirmed.\" We found no police statement confirming this. A police spokesperson told Factline they had received no such reports. Toxicologists we spoke to said no substance can make a person faint from a brief sniff of a sample. Versions of this rumour have circulated since at least 2017. Verdict: False.",
  },
  {
    url: "https://chirp.example/healthwatch_fic/status/7781200",
    title: "healthwatch (fictional) on Chirp",
    published: "2023-08-19",
    content:
      "Dr. Ama Felix of Bluewater Teaching Hospital confirmed it. Men are offering free perfume samples at filling stations in Lagos and Abuja. You smell it and you faint immediately, then they kidnap you. 2,000 women missing this month. Police have confirmed. Forward to every woman you know!",
  },
  {
    url: "https://verifydesk.example/2024/05/perfume-kidnap-doctor-quote",
    title: "Viral perfume-kidnapping message now cites a doctor who could not be found",
    published: "2024-05-01",
    content:
      "Verify Desk (fictional). The latest version of the perfume-kidnapping message adds: \"Dr. Ama Felix of Bluewater Teaching Hospital confirmed it.\" We could not find any doctor by that name or any hospital called Bluewater Teaching Hospital. The rest of the message, \"You smell it and you faint immediately, then they kidnap you. 2,000 women missing this month,\" matches a version Factline rated false in 2021.",
  },
  {
    url: "https://shopwise-news.example/2022/new-perfume-launch",
    title: "New perfume line launches with free samples at Lagos malls",
    published: "2022-04-11",
    content: "A fragrance brand (fictional) is giving away free perfume samples at three Lagos malls this weekend to launch its new line. Customers can pick up a sample at the counter.",
  },

  // ── Family B: "government cash grant" scam chain ───────────────────────────
  {
    url: "https://friendsbook.example/posts/relief-grant-20000",
    title: "Relief grant for households",
    published: "2020-04-08",
    content: "The Federal Government is giving N20,000 relief grant to every household affected by the lockdown. Apply here: relief-grant-apply.example",
  },
  {
    url: "https://forum.nairatalk.example/t/covid-relief-grant-30k-legit-53390",
    title: "COVID relief grant 30k - legit?",
    published: null,
    content:
      "Posted on 15 May 2020 by user bigdee. Federal Government is giving N30,000 COVID relief grant to every citizen. Click the link to apply: relief-grant-apply.example. I have applied and received mine. Reply from ifyok: This looks like scam o. Reply from bigdee: Na real thing.",
  },
  {
    url: "https://chirp.example/freebies_ng_fic/status/2201945",
    title: "freebies ng (fictional) on Chirp",
    published: "2021-01-20",
    content:
      "The Federal Government is giving N50,000 relief grant to every citizen. Click here to apply before Friday: fg-grant-portal.example. Share to 10 groups to activate your payment. 3,120 reposts",
  },
  {
    url: "https://factline.example/fact-check/n50000-government-grant-link-scam",
    title: "Scam alert: viral 'N50,000 government grant' link harvests bank details",
    published: "2021-03-02",
    content:
      "Factline Desk (fictional). A message claims \"The Federal Government is giving N50,000 relief grant to every citizen. Click here to apply before Friday\" and asks readers to \"Share to 10 groups to activate your payment.\" The link leads to a look-alike page that asks for bank login details. No government grant programme matches this description. Verdict: Scam.",
  },
  {
    url: "https://friendsbook.example/posts/ministry-approved-grant",
    title: "Approved grant",
    published: "2022-07-11",
    content:
      "Approved by the Ministry of Citizen Welfare: The Federal Government is giving N50,000 relief grant to every citizen. Click here to apply before Friday midnight: fg-grant-portal.example. Share to 10 groups to activate your payment.",
  },
  {
    url: "https://citypost-news.example/2023/10/police-warn-fake-grant-links",
    title: "Police warn residents about fake grant links",
    published: "2023-10-03",
    content:
      "City Post (fictional). Police have warned residents about a message that says the government \"is giving N50,000 relief grant to every citizen\" and urges people to \"Share to 10 groups to activate your payment.\" Officers said the links steal banking details. There is no Ministry of Citizen Welfare.",
  },

  // ── Family C: "schools closing over Lassa variant X" ───────────────────────
  {
    url: "https://forum.nairatalk.example/t/schools-closing-fever-60112",
    title: "Are schools in Kano closing?",
    published: "2022-01-10",
    content: "My cousin said schools in Kano will close for one week because of a strange fever outbreak. Has anyone heard this? Reply from sani_k: I haven't heard anything official.",
  },
  {
    url: "https://friendsbook.example/posts/schools-kano-kaduna-close",
    title: "Schools closing",
    published: "2022-01-12",
    content: "Schools in Kano and Kaduna will close for two weeks from Monday due to a fever outbreak. Keep your children at home.",
  },
  {
    url: "https://chirp.example/parents_net_fic/status/4410023",
    title: "parents net (fictional) on Chirp",
    published: "2022-01-14",
    content: "BREAKING: All schools nationwide will close for three weeks from Monday due to outbreak of Lassa variant X. Keep your children at home. Forward to all parents.",
  },
  {
    url: "https://factline.example/fact-check/schools-lassa-variant-x",
    title: "No, schools are not closing nationwide over 'Lassa variant X'",
    published: "2022-01-15",
    content:
      "Factline Desk (fictional). Messages claim \"All schools nationwide will close for three weeks from Monday due to outbreak of Lassa variant X.\" There is no known disease called 'Lassa variant X', and no education authority has announced closures. Verdict: False.",
  },
  {
    url: "https://schoolnews.example/2023/term-dates",
    title: "School term dates announced",
    published: "2023-08-30",
    content: "The new school term begins in September. Schools will close for the mid-term break for one week in October as planned.",
  },
];

/** Token-overlap ranking over the fictional corpus, mimicking a web search API. */
export function mockSearch(query: string, max: number, includeDomains?: string[]): SearchHit[] {
  const q = query.replace(/"/g, "");
  return MOCK_CORPUS.filter((p) => !includeDomains?.length || includeDomains.some((d) => new URL(p.url).hostname.endsWith(d)))
    .map((p) => ({ p, s: 0.6 * tokenOverlap(q, `${p.title} ${p.content}`) + 0.4 * relatedness(q, p.content) }))
    .filter(({ s }) => s > 0.22)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map(({ p, s }) => ({ url: p.url, title: p.title, content: p.content.slice(0, 300), score: Number(s.toFixed(3)), publishedDate: p.published }));
}

export function mockExtract(urls: string[]): ExtractedPage[] {
  return urls.flatMap((u) => {
    const p = MOCK_CORPUS.find((x) => x.url === u);
    if (!p) return [];
    const m = p.content.match(/Posted on (\d{1,2} \w+ \d{4})/);
    return [{ url: p.url, content: p.content, metaDate: m ? new Date(Date.parse(`${m[1]} UTC`)).toISOString().slice(0, 10) : null }];
  });
}
