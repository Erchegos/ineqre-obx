#!/usr/bin/env tsx
import { readFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";

const xml = readFileSync('/tmp/aker_raw.xml', 'utf-8');
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  trimValues: true,
});

const data = parser.parse(xml);
const snapshot = data.ReportSnapshot;

console.log('Issues structure:');
console.log(JSON.stringify(snapshot.Issues, null, 2));
