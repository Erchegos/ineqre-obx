# AI Summary Setup Guide

The research portal now supports AI-generated summaries that provide concise, key-point focused previews of research reports.

## How It Works

- **AI Summaries**: Clean, 2-3 bullet point summaries focusing on key metrics, developments, and recommendations
- **Visual Indicator**: Green left border = AI summary, Blue left border = raw text
- **Automatic Fallback**: Shows cleaned body text if no AI summary exists

## Setup Instructions

### 1. Get an Anthropic API Key

1. Go to https://console.anthropic.com
2. Create an account or sign in
3. Go to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-ant-...`)

### 2. Add API Key to Environment

Add to your `.env` file:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 3. Install Dependencies

```bash
npm install @anthropic-ai/sdk
```

### 4. Generate Summaries

Run the summary generation script:

```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
node scripts/generate-summaries.js
```

This will:
- Add the `ai_summary` column to the database (if needed)
- Generate summaries for the last 30 days of documents (max 50)
- Use Claude 3.5 Haiku (fast and cost-effective)
- Show progress for each document

### 5. View on Website

Visit https://ineqre.no/research and you'll see:
- Documents with AI summaries have a **green left border**
- Concise bullet points with key information
- No "Read more" button needed - summary is complete

## Cost Estimate

Using Claude 3.5 Haiku:
- ~$0.002 per summary (2000 input tokens, 500 output tokens)
- 50 summaries ≈ $0.10
- Very affordable for daily use

## Running Regularly

You can run this manually when needed, or add it to your automation:

```bash
# Generate summaries for new documents
node scripts/generate-summaries.js
```

## Example Output

Before (raw text):
```
Pareto High Yield Daily 22 JAN 2026 Booster â¢ Contemplates EUR 46m senior
secured bond â¢ Booster Precision Components Holding GmbH is contemplating...
[500+ words of dense text]
```

After (AI summary):
```
• Booster plans EUR 46m senior secured bond to refinance EUR 41.5m debt
• Q4 2025 EBITDA of EUR 17.6m exceeded full-year guidance
• Pareto Securities acts as Sole Bookrunner for bond issuance
```

Clean, concise, actionable!
