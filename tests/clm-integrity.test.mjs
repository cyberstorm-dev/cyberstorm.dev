/**
 * CLM Integrity Tests
 * 
 * Run before any deployment to verify:
 * 1. EAS attestations have valid parent references
 * 2. All sections have content
 * 3. Tree hierarchy is complete
 * 4. Content hashes are present
 */

const EAS_GRAPHQL = 'https://base-sepolia.easscan.org/graphql';
const CLM_SCHEMA_UID = '0xcac2a4177f75d29f7fef657aa221e510d888785ed7b1b2d16497ae839928fb05';

// Expected section IDs for CLM v1.0
const EXPECTED_SECTIONS = [
  'preamble', 'conclusion',
  '1', '1.0', '1.1', '1.2', '1.3', '1.4',
  '2', '2.1', '2.1.1', '2.1.2', '2.1.3', '2.1.4',
  '2.2', '2.2.1', '2.2.2', '2.2.3',
  '2.3', '2.3.1', '2.3.2', '2.3.3',
  '3', '3.1', '3.1.1', '3.1.2',
  '3.2', '3.2.1', '3.2.2',
  '3.3', '3.3.1', '3.3.2',
  '4', '4.1', '4.2', '4.2.1', '4.2.2', '4.2.3', '4.2.4'
];

// Expected parent-child relationships
const EXPECTED_HIERARCHY = {
  '1': ['1.0', '1.1', '1.2', '1.3', '1.4'],
  '2': ['2.1', '2.2', '2.3'],
  '2.1': ['2.1.1', '2.1.2', '2.1.3', '2.1.4'],
  '2.2': ['2.2.1', '2.2.2', '2.2.3'],
  '2.3': ['2.3.1', '2.3.2', '2.3.3'],
  '3': ['3.1', '3.2', '3.3'],
  '3.1': ['3.1.1', '3.1.2'],
  '3.2': ['3.2.1', '3.2.2'],
  '3.3': ['3.3.1', '3.3.2'],
  '4': ['4.1', '4.2'],
  '4.2': ['4.2.1', '4.2.2', '4.2.3', '4.2.4']
};

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
  }

  assert(condition, message) {
    if (condition) {
      this.passed++;
      console.log(`  ✓ ${message}`);
    } else {
      this.failed++;
      this.errors.push(message);
      console.log(`  ✗ ${message}`);
    }
  }

  summary() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${this.passed} passed, ${this.failed} failed`);
    if (this.errors.length > 0) {
      console.log(`\nFailures:`);
      this.errors.forEach(e => console.log(`  - ${e}`));
    }
    return this.failed === 0;
  }
}

async function fetchAttestations() {
  const query = `
    query GetCLMAttestations($schemaId: String!) {
      attestations(
        where: { schemaId: { equals: $schemaId }, revoked: { equals: false } }
        orderBy: { time: asc }
        take: 100
      ) {
        id
        decodedDataJson
      }
    }
  `;

  const response = await fetch(EAS_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { schemaId: CLM_SCHEMA_UID }
    })
  });

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL error: ${result.errors[0].message}`);
  }

  return result.data.attestations;
}

function parseAttestation(att) {
  const decoded = JSON.parse(att.decodedDataJson);
  const get = (name) => {
    const item = decoded.find(x => x.name === name);
    return item?.value?.value ?? null;
  };

  return {
    uid: att.id,
    sectionId: get('sectionId'),
    title: get('title'),
    content: get('content'),
    contentHash: get('contentHash'),
    parent: get('parent'),
    immutable: get('immutable')
  };
}

async function runTests() {
  const t = new TestRunner();
  
  console.log('Fetching attestations from EAS...\n');
  const attestations = await fetchAttestations();
  const sections = attestations.map(parseAttestation);
  
  // Build lookup maps
  const byId = new Map();
  const byUid = new Map();
  sections.forEach(s => {
    byId.set(s.sectionId, s);
    byUid.set(s.uid, s);
  });

  console.log(`Found ${sections.length} attestations\n`);

  // Test 1: All expected sections present
  console.log('Test 1: Section Completeness');
  for (const id of EXPECTED_SECTIONS) {
    t.assert(byId.has(id), `Section "${id}" exists`);
  }

  // Test 2: No unexpected sections
  console.log('\nTest 2: No Unexpected Sections');
  for (const s of sections) {
    t.assert(
      EXPECTED_SECTIONS.includes(s.sectionId),
      `Section "${s.sectionId}" is expected`
    );
  }

  // Test 3: All sections have content
  console.log('\nTest 3: Content Present');
  for (const s of sections) {
    // Container sections (like "1", "2") may not have content
    const isContainer = EXPECTED_HIERARCHY[s.sectionId] !== undefined && 
                        !['preamble', 'conclusion'].includes(s.sectionId);
    if (!isContainer) {
      t.assert(
        s.content && s.content.length > 0,
        `Section "${s.sectionId}" has content`
      );
    }
  }

  // Test 4: Content hashes present
  console.log('\nTest 4: Content Hashes');
  for (const s of sections) {
    t.assert(
      s.contentHash && s.contentHash !== ZERO_BYTES32,
      `Section "${s.sectionId}" has content hash`
    );
  }

  // Test 5: Parent UIDs are valid
  console.log('\nTest 5: Parent References Valid');
  for (const s of sections) {
    if (s.parent && s.parent !== ZERO_BYTES32) {
      const parentExists = byUid.has(s.parent);
      t.assert(
        parentExists,
        `Section "${s.sectionId}" parent UID exists (${s.parent.slice(0, 10)}...)`
      );
      
      if (parentExists) {
        const parentSection = byUid.get(s.parent);
        console.log(`    → resolves to "${parentSection.sectionId}"`);
      }
    }
  }

  // Test 6: Hierarchy correctness
  console.log('\nTest 6: Hierarchy Structure');
  for (const [parentId, expectedChildren] of Object.entries(EXPECTED_HIERARCHY)) {
    const parentSection = byId.get(parentId);
    if (!parentSection) continue;

    for (const childId of expectedChildren) {
      const childSection = byId.get(childId);
      if (!childSection) continue;

      // Child's parent UID should resolve to parent section
      const childParentSection = byUid.get(childSection.parent);
      t.assert(
        childParentSection?.sectionId === parentId,
        `"${childId}" parent resolves to "${parentId}"`
      );
    }
  }

  // Test 7: Root sections have null/zero parent
  console.log('\nTest 7: Root Sections');
  const rootSections = ['preamble', '1', '2', '3', '4', 'conclusion'];
  for (const id of rootSections) {
    const s = byId.get(id);
    if (s) {
      t.assert(
        !s.parent || s.parent === ZERO_BYTES32,
        `"${id}" is a root section (no parent)`
      );
    }
  }

  return t.summary();
}

// Run tests
runTests()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
