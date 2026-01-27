#!/usr/bin/env node
/**
 * Debug Norges Bank API to understand data structure
 */

interface NorgesBankRate {
  date: string;
  USD: number;
  EUR: number;
  GBP: number;
}

async function fetchFromNorgesBank(days: number = 30): Promise<NorgesBankRate[]> {
  console.log(`Fetching FX rates from Norges Bank for last ${days} days...`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const url = `https://data.norges-bank.no/api/data/EXR/B.USD+EUR+GBP.NOK.SP?format=sdmx-json&startPeriod=${formatDate(startDate)}&endPeriod=${formatDate(endDate)}&locale=en`;

  console.log(`URL: ${url}\n`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    console.log('Data structure keys:', Object.keys(data));
    console.log('Data.data keys:', Object.keys(data.data));
    console.log('Number of dataSets:', data.data.dataSets.length);
    console.log('Number of series:', Object.keys(data.data.dataSets[0].series).length);

    // Parse Norges Bank SDMX-JSON format
    const observations = data.data.dataSets[0].series;
    const structure = data.data.structure.dimensions.observation[0].values;

    console.log('\nNumber of observation dates:', structure.length);
    console.log('First 5 dates:', structure.slice(0, 5).map((v: any) => v.id));
    console.log('Last 5 dates:', structure.slice(-5).map((v: any) => v.id));

    const ratesByDate: Map<string, Partial<NorgesBankRate>> = new Map();

    // Process each currency series
    Object.keys(observations).forEach((seriesKey) => {
      const series = observations[seriesKey];
      const seriesIndex = parseInt(seriesKey.split(':')[1]);
      const currency = ['USD', 'EUR', 'GBP'][seriesIndex];

      console.log(`\nProcessing ${currency} (seriesKey: ${seriesKey})`);
      console.log(`  Number of observations: ${Object.keys(series.observations).length}`);

      Object.keys(series.observations).forEach((obsIndex) => {
        const dateIndex = parseInt(obsIndex);
        const date = structure[dateIndex].id;
        const rate = series.observations[obsIndex][0];

        if (!ratesByDate.has(date)) {
          ratesByDate.set(date, { date });
        }

        const entry = ratesByDate.get(date)!;
        entry[currency as 'USD' | 'EUR' | 'GBP'] = rate;
      });
    });

    console.log('\nTotal dates with data:', ratesByDate.size);

    // Convert to array and filter complete records
    const rates: NorgesBankRate[] = Array.from(ratesByDate.values())
      .filter((r) => r.USD && r.EUR && r.GBP)
      .map((r) => ({
        date: r.date!,
        USD: r.USD!,
        EUR: r.EUR!,
        GBP: r.GBP!,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    console.log(`\nComplete trading days: ${rates.length}`);
    console.log('First 3 rates:');
    rates.slice(0, 3).forEach(r => {
      console.log(`  ${r.date}: USD=${r.USD}, EUR=${r.EUR}, GBP=${r.GBP}`);
    });
    console.log('Last 3 rates:');
    rates.slice(-3).forEach(r => {
      console.log(`  ${r.date}: USD=${r.USD}, EUR=${r.EUR}, GBP=${r.GBP}`);
    });

    return rates;
  } catch (error) {
    console.error('Error fetching from Norges Bank:', error);
    throw error;
  }
}

fetchFromNorgesBank(30).catch(console.error);
