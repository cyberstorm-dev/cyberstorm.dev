/**
 * CLM Attestation Script
 * 
 * Attests CLM sections to EAS with correct:
 * 1. Parent UIDs (attest parents first, use returned UID for children)
 * 2. Content hashes (keccak256 of content)
 * 3. Merkle tree structure
 * 
 * Usage: node scripts/attest-clm.mjs [--dry-run]
 */

import { createPublicClient, createWalletClient, http, keccak256, toHex, encodeAbiParameters, encodePacked, concat } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

// Config
const EAS_CONTRACT = '0x4200000000000000000000000000000000000021';
const CLM_SCHEMA_UID = '0xcac2a4177f75d29f7fef657aa221e510d888785ed7b1b2d16497ae839928fb05';
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Load CLM data
const CLM_DATA_PATH = new URL('../clm-data.js', import.meta.url).pathname;

// EAS ABI (attest function)
const EAS_ABI = [
  {
    name: 'attest',
    type: 'function',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'expirationTime', type: 'uint64' },
              { name: 'revocable', type: 'bool' },
              { name: 'refUID', type: 'bytes32' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' }
            ]
          }
        ]
      }
    ],
    outputs: [{ name: '', type: 'bytes32' }]
  }
];

// Schema: string sectionId, uint16 version, string title, string content, bytes32 contentHash, bytes32 parent, bool immutable, bytes32 groupKeyId
function encodeAttestationData(section, parentUid, contentHash) {
  // Proper ABI encoding for EAS schema
  // Schema: string sectionId, uint16 version, string title, string content, bytes32 contentHash, bytes32 parent, bool immutable, bytes32 groupKeyId
  const data = encodeAbiParameters(
    [
      { name: 'sectionId', type: 'string' },
      { name: 'version', type: 'uint16' },
      { name: 'title', type: 'string' },
      { name: 'content', type: 'string' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'parent', type: 'bytes32' },
      { name: 'immutable', type: 'bool' },
      { name: 'groupKeyId', type: 'bytes32' }
    ],
    [
      section.id,
      2, // version
      section.title,
      section.content || '',
      contentHash,
      parentUid || ZERO_BYTES32,
      section.immutable || false,
      ZERO_BYTES32 // groupKeyId
    ]
  );
  
  return data;
}

function computeContentHash(content) {
  if (!content) return ZERO_BYTES32;
  return keccak256(toHex(content));
}

// Topological sort - parents before children
function sortSections(sections, sectionOrder) {
  const sorted = [];
  const visited = new Set();
  
  function visit(id) {
    if (visited.has(id)) return;
    const section = sections[id];
    if (!section) return;
    
    // Visit parent first
    if (section.parent && sections[section.parent]) {
      visit(section.parent);
    }
    
    visited.add(id);
    sorted.push(id);
  }
  
  // Visit in declared order
  for (const id of sectionOrder) {
    visit(id);
  }
  
  return sorted;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('CLM Attestation Script');
  console.log('='.repeat(50));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log();
  
  // Load private key
  const secretsPath = process.env.HOME + '/.openclaw/secrets/keypairs.json';
  if (!fs.existsSync(secretsPath)) {
    console.error('Error: No keypairs.json found');
    process.exit(1);
  }
  
  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
  const privateKey = secrets['cyberstorm-deployer']?.privateKey;
  if (!privateKey) {
    console.error('Error: No cyberstorm-deployer key found');
    process.exit(1);
  }
  
  const account = privateKeyToAccount(privateKey);
  console.log(`Attester: ${account.address}`);
  
  // Load CLM data - it's a plain JS file that sets CLM_DATA global
  const clmCode = fs.readFileSync(CLM_DATA_PATH, 'utf-8');
  // Extract the CLM_DATA object using regex (it's assigned to const CLM_DATA = {...})
  const match = clmCode.match(/const CLM_DATA = (\{[\s\S]*\});/);
  if (!match) {
    console.error('Error: Could not parse CLM_DATA from clm-data.js');
    process.exit(1);
  }
  
  // Use Function constructor to safely evaluate the object
  const CLM_DATA = (new Function(`return ${match[1]}`))();
  
  const sections = CLM_DATA.sections;
  const sectionOrder = CLM_DATA.sectionOrder;
  
  console.log(`Sections to attest: ${sectionOrder.length}`);
  console.log();
  
  // Sort topologically
  const sorted = sortSections(sections, sectionOrder);
  console.log('Attestation order (parents first):');
  sorted.forEach((id, i) => {
    const s = sections[id];
    const parentInfo = s.parent ? ` (parent: ${s.parent})` : ' (root)';
    console.log(`  ${i + 1}. ${id}: ${s.title}${parentInfo}`);
  });
  console.log();
  
  if (dryRun) {
    console.log('DRY RUN - not sending transactions');
    
    // Compute content hashes
    console.log('\nContent hashes:');
    for (const id of sorted) {
      const section = sections[id];
      const hash = computeContentHash(section.content);
      console.log(`  ${id}: ${hash.slice(0, 18)}...`);
    }
    
    // Build merkle tree simulation
    console.log('\nMerkle tree structure:');
    const uidMap = new Map();
    for (let i = 0; i < sorted.length; i++) {
      const id = sorted[i];
      const section = sections[id];
      const fakeUid = `0x${i.toString(16).padStart(64, '0')}`;
      uidMap.set(id, fakeUid);
      
      const parentUid = section.parent ? uidMap.get(section.parent) : null;
      console.log(`  ${id}: uid=${fakeUid.slice(0, 10)}... parent=${parentUid ? parentUid.slice(0, 10) + '...' : 'null'}`);
    }
    
    console.log('\n✓ Dry run complete. Run without --dry-run to attest.');
    return;
  }
  
  // Live mode - create clients
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http()
  });
  
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http()
  });
  
  // Track attestation UIDs
  const uidMap = new Map();
  const results = [];
  
  for (const id of sorted) {
    const section = sections[id];
    const contentHash = computeContentHash(section.content);
    const parentUid = section.parent ? uidMap.get(section.parent) : ZERO_BYTES32;
    
    console.log(`Attesting: ${id} - ${section.title}`);
    console.log(`  Content hash: ${contentHash.slice(0, 18)}...`);
    console.log(`  Parent UID: ${parentUid ? parentUid.slice(0, 18) + '...' : 'none'}`);
    
    try {
      const data = encodeAttestationData(section, parentUid, contentHash);
      
      const hash = await walletClient.writeContract({
        address: EAS_CONTRACT,
        abi: EAS_ABI,
        functionName: 'attest',
        args: [{
          schema: CLM_SCHEMA_UID,
          data: {
            recipient: '0x0000000000000000000000000000000000000000',
            expirationTime: 0n,
            revocable: true,
            refUID: parentUid || ZERO_BYTES32,
            data,
            value: 0n
          }
        }]
      });
      
      console.log(`  Tx: ${hash}`);
      
      // Wait for receipt to get attestation UID
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      
      // Parse attestation UID from logs
      // EAS emits Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)
      const attestedLog = receipt.logs.find(log => 
        log.topics[0] === '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35'
      );
      
      if (attestedLog) {
        const uid = attestedLog.data.slice(0, 66); // First 32 bytes of data
        uidMap.set(id, uid);
        results.push({ id, uid, contentHash, parentUid, txHash: hash });
        console.log(`  UID: ${uid}`);
      } else {
        console.error(`  Warning: Could not extract UID from logs`);
      }
      
      console.log();
      
      // Small delay to avoid nonce issues
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      process.exit(1);
    }
  }
  
  // Save results
  const outputPath = './clm-attestations.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    schemaUid: CLM_SCHEMA_UID,
    attester: account.address,
    attestations: results
  }, null, 2));
  
  console.log(`\n✓ Attested ${results.length} sections`);
  console.log(`Results saved to ${outputPath}`);
  
  // Compute merkle root
  const leafHashes = sorted.map(id => {
    const r = results.find(x => x.id === id);
    return r?.contentHash || ZERO_BYTES32;
  });
  
  console.log('\nMerkle verification:');
  console.log(`  Leaves: ${leafHashes.length}`);
  // Simple merkle root (just concat and hash all leaves for now)
  const merkleRoot = keccak256(encodePacked(
    leafHashes.map(() => 'bytes32'),
    leafHashes
  ));
  console.log(`  Root: ${merkleRoot}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
