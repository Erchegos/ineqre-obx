/**
 * Check Supabase Storage bucket configuration
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBucket() {
  console.log('Checking Supabase Storage bucket...\n');

  // List buckets
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error('Error listing buckets:', listError);
    return;
  }

  console.log('Available buckets:');
  buckets.forEach(bucket => {
    console.log(`  - ${bucket.name} (public: ${bucket.public})`);
  });

  // Try to download a test file
  console.log('\nTesting file download...');
  const testPath = '2026/01/1abb8c1c-8ffc-4162-b5b1-6f4949891223/report_Seafood___The_Art_of_the_U_turn___Newsflash.pdf';

  const { data, error } = await supabase.storage
    .from('research-pdfs')
    .download(testPath);

  if (error) {
    console.error('Download error:', error);
  } else {
    console.log('✓ Successfully downloaded test file:', data.size, 'bytes');
  }

  // List files in bucket
  console.log('\nListing files in bucket...');
  const { data: files, error: filesError } = await supabase.storage
    .from('research-pdfs')
    .list('2026/01', {
      limit: 5,
      sortBy: { column: 'name', order: 'asc' }
    });

  if (filesError) {
    console.error('Error listing files:', filesError);
  } else {
    console.log(`Found ${files.length} directories/files:`);
    files.forEach(file => {
      console.log(`  - ${file.name}`);
    });
  }
}

checkBucket().catch(console.error);
