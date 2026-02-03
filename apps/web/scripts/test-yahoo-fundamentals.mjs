import YF from 'yahoo-finance2';

const yf = new YF({ suppressNotices: ['yahooSurvey'] });
const tickers = ['DNB.OL','EQNR.OL','NHY.OL','MOWI.OL','FRO.OL','TEL.OL','AKRBP.OL','ORK.OL','YAR.OL','STB.OL'];

for (const t of tickers) {
  try {
    const q = await yf.quote(t);
    const summary = await yf.quoteSummary(t, { modules: ['financialData','defaultKeyStatistics'] });
    const fd = summary.financialData || {};

    const pe = q.trailingPE;
    const pb = q.priceToBook;
    const dy = q.dividendYield;
    const rev = fd.totalRevenue;
    const mktcap = q.marketCap;
    const ps = (rev && mktcap) ? mktcap / rev : null;
    const revGrowth = fd.revenueGrowth;

    const sg = revGrowth != null ? (revGrowth * 100).toFixed(1) + '%' : 'N/A';
    const mcap = mktcap ? (mktcap / 1e9).toFixed(0) + 'B' : 'N/A';

    console.log(
      t.padEnd(10),
      'PE=' + String(pe ? pe.toFixed(2) : 'N/A').padEnd(8),
      'PB=' + String(pb ? pb.toFixed(2) : 'N/A').padEnd(8),
      'DY=' + String(dy ? dy.toFixed(2) : 'N/A').padEnd(8),
      'PS=' + String(ps ? ps.toFixed(2) : 'N/A').padEnd(8),
      'SG=' + String(sg).padEnd(8),
      'MCap=' + mcap
    );
  } catch (e) {
    console.log(t.padEnd(10), 'ERROR:', e.message ? e.message.substring(0, 80) : e);
  }
}
