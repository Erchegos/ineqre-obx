#!/usr/bin/env tsx
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function main() {
  // Comprehensive sector corrections based on actual business
  const corrections = [
    // Technology companies misclassified as Energy
    { ticker: 'BOUV', sector: 'Technology', note: 'Bouvet - IT consulting' },
    { ticker: 'OTEC', sector: 'Technology', note: 'Otello Corporation - Ad tech' },
    { ticker: 'TECH', sector: 'Technology', note: 'Techstep - IT services' },

    // Seafood company misclassified as Consumer
    { ticker: 'BAKKA', sector: 'Seafood', note: 'Bakkafrost - Salmon farming' },

    // Shipping/Investment company
    { ticker: 'BONHR', sector: 'Investment', note: 'Bonheur - Diversified holding company' },

    // Shipping companies misclassified as Investment
    { ticker: 'KCC', sector: 'Shipping', note: 'Klaveness Combination Carriers' },
    { ticker: 'ODF', sector: 'Shipping', note: 'Odfjell - Chemical tankers' },
    { ticker: 'ODL', sector: 'Shipping', note: 'Odfjell Drilling - Offshore drilling' },

    // Industrial companies misclassified as Investment
    { ticker: 'VEI', sector: 'Industrial', note: 'Veidekke - Construction' },
    { ticker: 'AFG', sector: 'Industrial', note: 'AF Gruppen - Construction' },
    { ticker: 'ABL', sector: 'Industrial', note: 'ABL Group - Marine/offshore engineering' },

    // Finance company misclassified as Investment
    { ticker: 'PROT', sector: 'Finance', note: 'Protector Forsikring - Insurance' },

    // Healthcare/Biotech companies misclassified as Investment
    { ticker: 'PCIB', sector: 'Healthcare', note: 'PCI Biotech - Biotech' },
    { ticker: 'PHO', sector: 'Healthcare', note: 'Photocure - Medical devices/pharma' },

    // Technology company misclassified as Finance
    { ticker: 'SWON', sector: 'Technology', note: 'SoftwareOne - Software' },

    // Engineering consulting misclassified as Real Estate
    { ticker: 'MULTI', sector: 'Industrial', note: 'Multiconsult - Engineering consulting' },
  ];

  console.log('Comprehensive sector classification fixes...\n');

  for (const { ticker, sector, note } of corrections) {
    // Get current sector
    const current = await pool.query('SELECT sector FROM stocks WHERE ticker = $1', [ticker]);

    if (current.rows.length === 0) {
      console.log(`⚠ ${ticker}: NOT FOUND in database`);
      continue;
    }

    const oldSector = current.rows[0]?.sector || 'NULL';

    // Update
    await pool.query('UPDATE stocks SET sector = $1 WHERE ticker = $2', [sector, ticker]);
    console.log(`✓ ${ticker}: ${oldSector} → ${sector} (${note})`);
  }

  // Show updated sector distribution
  const result = await pool.query(`
    SELECT sector, COUNT(*) as count
    FROM stocks
    GROUP BY sector
    ORDER BY count DESC
  `);

  console.log('\nFinal Sector Distribution:');
  console.log('='.repeat(50));
  result.rows.forEach(row => console.log(`${row.sector || 'NULL'}: ${row.count}`));

  await pool.end();
}

main();
