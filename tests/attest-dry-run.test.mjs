/**
 * Attestation Dry-Run Validation
 * 
 * Runs the attestation script in dry-run mode and verifies
 * the output would produce valid attestations.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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

const ROOT_SECTIONS = ['preamble', '1', '2', '3', '4', 'conclusion'];

const EXPECTED_CHILDREN = {
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

function parseDryRunOutput(output) {
  const lines = output.split('\n');
  const sections = [];
  const contentHashes = new Map();
  const merkleTree = new Map();
  
  let inOrder = false;
  let inHashes = false;
  let inMerkle = false;
  
  for (const line of lines) {
    if (line.includes('Attestation order')) {
      inOrder = true;
      continue;
    }
    if (line.includes('Content hashes:')) {
      inOrder = false;
      inHashes = true;
      continue;
    }
    if (line.includes('Merkle tree structure:')) {
      inHashes = false;
      inMerkle = true;
      continue;
    }
    
    if (inOrder) {
      // Parse: "  1. preamble: Preamble (root)" or "  3. 1.0: Directive 1.0 (parent: 1)"
      const match = line.match(/^\s+\d+\.\s+([^:]+):\s+.+\((root|parent:\s*(\S+))\)/);
      if (match) {
        sections.push({
          id: match[1],
          isRoot: match[2] === 'root',
          parent: match[3] || null
        });
      }
    }
    
    if (inHashes) {
      const match = line.match(/^\s+([^:]+):\s+(0x[a-f0-9]+)/);
      if (match) {
        contentHashes.set(match[1], match[2]);
      }
    }
    
    if (inMerkle) {
      const match = line.match(/^\s+([^:]+):\s+uid=([^\s]+)\s+parent=(\S+)/);
      if (match) {
        merkleTree.set(match[1], {
          uid: match[2],
          parent: match[3] === 'null' ? null : match[3]
        });
      }
    }
  }
  
  return { sections, contentHashes, merkleTree };
}

async function runTests() {
  const t = new TestRunner();
  
  console.log('Running attestation script in dry-run mode...\n');
  
  let output;
  try {
    output = execSync('node scripts/attest-clm.mjs --dry-run', {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf-8',
      timeout: 30000
    });
  } catch (err) {
    console.error('Failed to run dry-run script:', err.message);
    process.exit(1);
  }
  
  console.log('Parsing output...\n');
  const { sections, contentHashes, merkleTree } = parseDryRunOutput(output);
  
  // Test 1: All sections present
  console.log('Test 1: Section Completeness');
  const sectionIds = sections.map(s => s.id);
  for (const expected of EXPECTED_SECTIONS) {
    t.assert(sectionIds.includes(expected), `Section "${expected}" in attestation order`);
  }
  
  // Test 2: Correct root sections
  console.log('\nTest 2: Root Sections');
  for (const s of sections) {
    if (ROOT_SECTIONS.includes(s.id)) {
      t.assert(s.isRoot, `"${s.id}" is marked as root`);
    } else {
      t.assert(!s.isRoot, `"${s.id}" is not marked as root`);
    }
  }
  
  // Test 3: Parent ordering (parent comes before child)
  console.log('\nTest 3: Topological Order (parents before children)');
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.parent) {
      const parentIndex = sections.findIndex(x => x.id === s.parent);
      t.assert(parentIndex < i, `"${s.id}" parent "${s.parent}" appears before it (idx ${parentIndex} < ${i})`);
    }
  }
  
  // Test 4: Correct parent relationships
  console.log('\nTest 4: Parent Relationships');
  for (const [parentId, expectedChildren] of Object.entries(EXPECTED_CHILDREN)) {
    for (const childId of expectedChildren) {
      const child = sections.find(s => s.id === childId);
      t.assert(child?.parent === parentId, `"${childId}" has parent "${parentId}"`);
    }
  }
  
  // Test 5: Content hashes present
  console.log('\nTest 5: Content Hashes');
  for (const id of EXPECTED_SECTIONS) {
    const hash = contentHashes.get(id);
    t.assert(hash !== undefined, `"${id}" has content hash`);
  }
  
  // Test 6: Merkle tree structure
  console.log('\nTest 6: Merkle Tree UIDs');
  t.assert(merkleTree.size === EXPECTED_SECTIONS.length, `Merkle tree has ${EXPECTED_SECTIONS.length} entries (got ${merkleTree.size})`);
  
  // Each non-root should have a parent UID
  for (const [id, node] of merkleTree) {
    if (!ROOT_SECTIONS.includes(id)) {
      t.assert(node.parent !== null, `"${id}" has parent UID in merkle tree`);
    }
  }
  
  return t.summary();
}

runTests()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
