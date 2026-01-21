const bcrypt = require('bcrypt');

async function testAndGenerateHash() {
  const testPassword = 'research2024';
  
  // Generate a fresh hash
  console.log('Generating hash for password: research2024');
  const newHash = await bcrypt.hash(testPassword, 10);
  console.log('Generated hash:', newHash);
  
  // Test it
  const matches = await bcrypt.compare(testPassword, newHash);
  console.log('Verification test:', matches ? 'PASS' : 'FAIL');
  
  console.log('\n=== SQL UPDATE COMMAND ===');
  console.log(`UPDATE research_access_tokens SET token_hash = '${newHash}' WHERE description = 'Default research portal access';`);
}

testAndGenerateHash().catch(console.error);
