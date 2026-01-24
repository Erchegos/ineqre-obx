/**
 * IBKR Fundamentals XML Parser
 * Parses XML data from IBKR fundamental reports
 */

import { XMLParser } from "fast-xml-parser";

export interface ParsedCompanyData {
  // Identifiers
  ticker: string;
  companyName: string;
  isin?: string;
  ric?: string;
  permId?: string;
  exchange: string;
  exchangeCountry?: string;

  // Basic info
  status: string;
  companyType: string;
  businessSummary?: string;
  financialSummary?: string;

  // Operational data
  employees?: number;
  employeesLastUpdated?: string;
  sharesOutstanding?: number;
  totalFloat?: number;
  sharesDate?: string;
  reportingCurrency?: string;
  latestAnnualDate?: string;
  latestInterimDate?: string;

  // Industry classification
  sector?: string;
  industry?: string;
  trbc?: string;
  naicsCodes?: string[];
  sicCodes?: string[];

  // Contact information
  address?: {
    street: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    countryCode?: string;
  };
  phone?: {
    main?: string;
    fax?: string;
    contact?: string;
  };
  email?: string;
  website?: string;
  investorRelationsContact?: {
    name?: string;
    title?: string;
    phone?: string;
  };

  // Officers
  officers?: Array<{
    rank: number;
    firstName: string;
    lastName: string;
    age?: number;
    title: string;
    since?: string;
  }>;

  // Metadata
  lastModified?: string;
  lastUpdated?: string;
}

export class FundamentalsParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
      trimValues: true,
    });
  }

  /**
   * Parse company overview XML
   */
  parseCompanyOverview(xml: string): ParsedCompanyData {
    const data = this.parser.parse(xml);
    const snapshot = data.ReportSnapshot;

    if (!snapshot) {
      throw new Error("Invalid XML: Missing ReportSnapshot");
    }

    const result: ParsedCompanyData = {
      ticker: "",
      companyName: "",
      exchange: "",
      status: "",
      companyType: "",
    };

    // Parse company IDs
    this.parseCompanyIds(snapshot.CoIDs, result);

    // Parse issue information
    if (snapshot.Issues?.Issue) {
      this.parseIssueInfo(snapshot.Issues.Issue, result);
    }

    // Parse general info
    if (snapshot.CoGeneralInfo) {
      this.parseGeneralInfo(snapshot.CoGeneralInfo, result);
    }

    // Parse text info (descriptions)
    if (snapshot.TextInfo?.Text) {
      this.parseTextInfo(snapshot.TextInfo.Text, result);
    }

    // Parse contact info
    if (snapshot.contactInfo) {
      this.parseContactInfo(snapshot.contactInfo, result);
    }

    // Parse web links
    if (snapshot.webLinks) {
      this.parseWebLinks(snapshot.webLinks, result);
    }

    // Parse industry/peer info
    if (snapshot.peerInfo?.IndustryInfo?.Industry) {
      this.parseIndustryInfo(snapshot.peerInfo.IndustryInfo.Industry, result);
    }

    // Parse officers
    if (snapshot.officers?.officer) {
      this.parseOfficers(snapshot.officers.officer, result);
    }

    return result;
  }

  private parseCompanyIds(coIds: any, result: ParsedCompanyData): void {
    if (!coIds?.CoID) return;

    const ids = Array.isArray(coIds.CoID) ? coIds.CoID : [coIds.CoID];

    for (const id of ids) {
      const type = id["@_Type"];
      const value = id["#text"] || id;

      switch (type) {
        case "CompanyName":
          result.companyName = value;
          break;
        case "OrganizationPermID":
          result.permId = value;
          break;
      }
    }
  }

  private parseIssueInfo(issue: any, result: ParsedCompanyData): void {
    // Handle case where issue is an array (multiple issues)
    // We want the first issue with a valid ticker
    const issues = Array.isArray(issue) ? issue : [issue];

    for (const singleIssue of issues) {
      if (!singleIssue.IssueID) continue;

      const ids = Array.isArray(singleIssue.IssueID) ? singleIssue.IssueID : [singleIssue.IssueID];
      let foundTicker = false;

      for (const id of ids) {
        const type = id["@_Type"];
        const value = id["#text"] || id;

        switch (type) {
          case "Ticker":
            result.ticker = value;
            foundTicker = true;
            break;
          case "ISIN":
            result.isin = value;
            break;
          case "RIC":
            result.ric = value;
            break;
        }
      }

      if (singleIssue.Exchange) {
        result.exchange = singleIssue.Exchange["#text"] || singleIssue.Exchange;
        result.exchangeCountry = singleIssue.Exchange["@_Country"];
      }

      // If we found a ticker in this issue, we're done
      if (foundTicker && result.ticker) {
        break;
      }
    }
  }

  private parseGeneralInfo(info: any, result: ParsedCompanyData): void {
    // Status
    if (info.CoStatus) {
      result.status = info.CoStatus["#text"] || info.CoStatus;
    }

    // Type
    if (info.CoType) {
      result.companyType = info.CoType["#text"] || info.CoType;
    }

    // Employees
    if (info.Employees) {
      result.employees = parseInt(info.Employees["#text"] || info.Employees);
      result.employeesLastUpdated = info.Employees["@_LastUpdated"];
    }

    // Shares outstanding
    if (info.SharesOut) {
      const sharesValue = info.SharesOut["#text"] || info.SharesOut;
      result.sharesOutstanding = parseFloat(sharesValue);
      result.totalFloat = parseFloat(info.SharesOut["@_TotalFloat"]);
      result.sharesDate = info.SharesOut["@_Date"];
    }

    // Currency
    if (info.ReportingCurrency) {
      result.reportingCurrency = info.ReportingCurrency["@_Code"];
    }

    // Latest reporting dates
    result.latestAnnualDate = info.LatestAvailableAnnual;
    result.latestInterimDate = info.LatestAvailableInterim;
    result.lastModified = info.LastModified;
  }

  private parseTextInfo(texts: any, result: ParsedCompanyData): void {
    const textArray = Array.isArray(texts) ? texts : [texts];

    for (const text of textArray) {
      const type = text["@_Type"];
      const value = text["#text"] || text;

      switch (type) {
        case "Business Summary":
          result.businessSummary = value;
          break;
        case "Financial Summary":
          result.financialSummary = value;
          break;
      }
    }
  }

  private parseContactInfo(contact: any, result: ParsedCompanyData): void {
    result.lastUpdated = contact["@_lastUpdated"];

    // Address
    const streetLines: string[] = [];
    if (contact.streetAddress) {
      const streets = Array.isArray(contact.streetAddress)
        ? contact.streetAddress
        : [contact.streetAddress];

      for (const street of streets) {
        const value = street["#text"] || street;
        if (value && typeof value === "string" && value.trim()) {
          streetLines.push(value.trim());
        }
      }
    }

    result.address = {
      street: streetLines,
      city: contact.city,
      state: contact["state-region"],
      postalCode: contact.postalCode,
      country: contact.country?.["#text"] || contact.country,
      countryCode: contact.country?.["@_code"],
    };

    // Phones
    if (contact.phone?.phone) {
      const phones = Array.isArray(contact.phone.phone)
        ? contact.phone.phone
        : [contact.phone.phone];

      result.phone = {};

      for (const phone of phones) {
        const type = phone["@_type"];
        const countryCode = phone.countryPhoneCode;
        const areaCode = phone["city-areacode"];
        const number = phone.number;

        const fullNumber = `+${countryCode}-${areaCode}-${number}`;

        switch (type) {
          case "mainphone":
            result.phone.main = fullNumber;
            break;
          case "mainfax":
            result.phone.fax = fullNumber;
            break;
          case "contactphone":
            result.phone.contact = fullNumber;
            break;
        }
      }
    }

    // Investor relations contact
    if (contact.contactName) {
      result.investorRelationsContact = {
        name: contact.contactName,
        title: contact.contactTitle,
        phone: result.phone?.contact,
      };
    }
  }

  private parseWebLinks(links: any, result: ParsedCompanyData): void {
    if (links.webSite) {
      result.website = links.webSite["#text"] || links.webSite;
    }
    if (links.eMail) {
      result.email = links.eMail["#text"] || links.eMail;
    }
  }

  private parseIndustryInfo(industries: any, result: ParsedCompanyData): void {
    const industryArray = Array.isArray(industries) ? industries : [industries];

    result.naicsCodes = [];
    result.sicCodes = [];

    for (const industry of industryArray) {
      const type = industry["@_type"];
      const code = industry["@_code"];
      const name = industry["#text"] || industry;

      if (type === "TRBC" && industry["@_order"] === 1) {
        result.industry = name;
        result.trbc = code;
      } else if (type === "NAICS") {
        result.naicsCodes.push(`${code}: ${name}`);
      } else if (type === "SIC") {
        result.sicCodes.push(`${code}: ${name}`);
      }
    }
  }

  private parseOfficers(officers: any, result: ParsedCompanyData): void {
    const officerArray = Array.isArray(officers) ? officers : [officers];

    result.officers = [];

    for (const officer of officerArray) {
      const rank = officer["@_rank"];
      const since = officer["@_since"];

      result.officers.push({
        rank: parseInt(rank),
        firstName: officer.firstName,
        lastName: officer.lastName,
        age: officer.age ? parseInt(officer.age) : undefined,
        title: officer.title?.["#text"] || officer.title,
        since,
      });
    }
  }

  /**
   * Format parsed data as human-readable text
   */
  formatAsText(data: ParsedCompanyData): string {
    const lines: string[] = [];

    lines.push("=".repeat(70));
    lines.push(`${data.companyName} (${data.ticker})`);
    lines.push("=".repeat(70));
    lines.push("");

    // Basic info
    lines.push("COMPANY INFORMATION");
    lines.push("-".repeat(70));
    lines.push(`Ticker: ${data.ticker}`);
    lines.push(`Exchange: ${data.exchange} (${data.exchangeCountry})`);
    lines.push(`ISIN: ${data.isin || "N/A"}`);
    lines.push(`Status: ${data.status}`);
    lines.push(`Type: ${data.companyType}`);
    lines.push("");

    // Industry
    if (data.industry || data.sector) {
      lines.push("INDUSTRY");
      lines.push("-".repeat(70));
      if (data.industry) lines.push(`Industry: ${data.industry}`);
      if (data.sector) lines.push(`Sector: ${data.sector}`);
      lines.push("");
    }

    // Operational data
    lines.push("OPERATIONAL DATA");
    lines.push("-".repeat(70));
    if (data.employees) {
      lines.push(`Employees: ${data.employees.toLocaleString()} (as of ${data.employeesLastUpdated})`);
    }
    if (data.sharesOutstanding) {
      lines.push(`Shares Outstanding: ${data.sharesOutstanding.toLocaleString()}`);
      if (data.totalFloat) {
        lines.push(`Total Float: ${data.totalFloat.toLocaleString()}`);
      }
      lines.push(`Shares Date: ${data.sharesDate}`);
    }
    if (data.reportingCurrency) {
      lines.push(`Reporting Currency: ${data.reportingCurrency}`);
    }
    if (data.latestAnnualDate) {
      lines.push(`Latest Annual Report: ${data.latestAnnualDate}`);
    }
    if (data.latestInterimDate) {
      lines.push(`Latest Interim Report: ${data.latestInterimDate}`);
    }
    lines.push("");

    // Business description
    if (data.businessSummary) {
      lines.push("BUSINESS DESCRIPTION");
      lines.push("-".repeat(70));
      lines.push(data.businessSummary);
      lines.push("");
    }

    // Financial summary
    if (data.financialSummary) {
      lines.push("FINANCIAL SUMMARY");
      lines.push("-".repeat(70));
      lines.push(data.financialSummary);
      lines.push("");
    }

    // Contact info
    if (data.address || data.phone || data.email || data.website) {
      lines.push("CONTACT INFORMATION");
      lines.push("-".repeat(70));

      if (data.address) {
        data.address.street.forEach((line) => lines.push(line));
        if (data.address.city) {
          lines.push(`${data.address.city} ${data.address.postalCode || ""}`);
        }
        if (data.address.country) {
          lines.push(data.address.country);
        }
      }

      if (data.phone?.main) lines.push(`Phone: ${data.phone.main}`);
      if (data.phone?.fax) lines.push(`Fax: ${data.phone.fax}`);
      if (data.email) lines.push(`Email: ${data.email}`);
      if (data.website) lines.push(`Website: ${data.website}`);

      if (data.investorRelationsContact) {
        lines.push("");
        lines.push("Investor Relations:");
        lines.push(`  ${data.investorRelationsContact.name}`);
        if (data.investorRelationsContact.title) {
          lines.push(`  ${data.investorRelationsContact.title}`);
        }
        if (data.investorRelationsContact.phone) {
          lines.push(`  ${data.investorRelationsContact.phone}`);
        }
      }

      lines.push("");
    }

    // Officers
    if (data.officers && data.officers.length > 0) {
      lines.push("KEY EXECUTIVES");
      lines.push("-".repeat(70));

      for (const officer of data.officers.slice(0, 5)) {
        // Top 5
        const age = officer.age ? `, age ${officer.age}` : "";
        lines.push(`${officer.rank}. ${officer.firstName} ${officer.lastName}${age}`);
        lines.push(`   ${officer.title}`);
        if (officer.since) lines.push(`   Since: ${officer.since}`);
        lines.push("");
      }
    }

    return lines.join("\n");
  }
}
