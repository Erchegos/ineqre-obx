/**
 * Verify PDFs exist in Supabase Storage
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('Verifying PDFs in Supabase Storage...\n');

  const paths = [
    '2026/01/cd711ec8-cd00-47ea-8bf9-999f58c0c7dc/467915.pdf',
    '2026/01/1bedf3c4-f52b-4f9f-b65c-41c3f17c0591/467917.pdf'
  ];

  for (const path of paths) {
    console.log(`Checking: ${path}`);

    // Try to get the file info
    const { data, error } = await supabase.storage
      .from('research-pdfs')
      .list(path.substring(0, path.lastIndexOf('/')), {
        search: path.substring(path.lastIndexOf('/') + 1)
      });

    if (error) {
      console.log(`  ✗ Error: ${error.message}`);
    } else if (data && data.length > 0) {
      const file = data[0];
      console.log(`  ✓ Found: ${file.name} (${Math.round(file.metadata?.size / 1024)}KB)`);
    } else {
      console.log(`  ✗ Not found`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
