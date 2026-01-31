/**
 * EAS GraphQL Client for CLM
 * 
 * Fetches CLM attestations from Base Sepolia EAS.
 * Falls back to mock data if no attestations found.
 */

const EAS_CONFIG = {
  // Base Sepolia
  84532: {
    graphql: 'https://base-sepolia.easscan.org/graphql',
    explorer: 'https://base-sepolia.easscan.org/attestation/view',
    basescan: 'https://sepolia.basescan.org',
    schemaUid: '0xcac2a4177f75d29f7fef657aa221e510d888785ed7b1b2d16497ae839928fb05', // v2 with groupKeyId
  },
  // Base Mainnet
  8453: {
    graphql: 'https://base.easscan.org/graphql',
    explorer: 'https://base.easscan.org/attestation/view',
    basescan: 'https://basescan.org',
    schemaUid: null, // Deploy to mainnet when ready
  }
};

// CLM schema definition
const CLM_SCHEMA = 'string sectionId,uint16 version,string title,string content,bytes32 contentHash,bytes32 parent,bool immutable';

// Load deployment info if available
let DEPLOYMENT_INFO = null;

async function loadDeploymentInfo() {
  try {
    const resp = await fetch('clm-deployment.json');
    if (resp.ok) {
      DEPLOYMENT_INFO = await resp.json();
      if (DEPLOYMENT_INFO.schemaUid && DEPLOYMENT_INFO.chainId) {
        EAS_CONFIG[DEPLOYMENT_INFO.chainId].schemaUid = DEPLOYMENT_INFO.schemaUid;
      }
      return DEPLOYMENT_INFO;
    }
  } catch (e) {
    console.log('No deployment info found, using mock data');
  }
  return null;
}

// GraphQL query for CLM attestations
const ATTESTATIONS_QUERY = `
  query GetCLMAttestations($schemaId: String!) {
    attestations(
      where: { schemaId: { equals: $schemaId }, revoked: { equals: false } }
      orderBy: { time: asc }
      take: 100
    ) {
      id
      attester
      recipient
      refUID
      revocable
      revocationTime
      expirationTime
      time
      txid
      decodedDataJson
    }
  }
`;

// Decode attestation data
function decodeAttestationData(decodedDataJson) {
  try {
    const data = JSON.parse(decodedDataJson);
    const result = {};
    for (const item of data) {
      const name = item.name;
      let value = item.value?.value ?? item.value;
      // Handle hex bytes32 values
      if (typeof value === 'object' && value.hex) {
        value = value.hex;
      }
      result[name] = value;
    }
    return result;
  } catch (e) {
    console.error('Failed to decode attestation data:', e);
    return null;
  }
}

// Fetch CLM from EAS
async function fetchCLMFromEAS(chainId = 84532) {
  const config = EAS_CONFIG[chainId];
  if (!config || !config.schemaUid) {
    console.log('No schema UID configured for chain', chainId);
    return null;
  }

  try {
    const response = await fetch(config.graphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ATTESTATIONS_QUERY,
        variables: { schemaId: config.schemaUid }
      })
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const result = await response.json();
    if (result.errors) {
      throw new Error(result.errors[0].message);
    }

    const attestations = result.data?.attestations || [];
    if (attestations.length === 0) {
      console.log('No attestations found for schema');
      return null;
    }

    // Convert attestations to CLM_DATA format
    const sections = {};
    const sectionOrder = [];
    let rootAttestation = null;

    for (const att of attestations) {
      const decoded = decodeAttestationData(att.decodedDataJson);
      if (!decoded) continue;

      const sectionId = decoded.sectionId;
      sections[sectionId] = {
        id: sectionId,
        title: decoded.title,
        content: decoded.content,
        contentHash: decoded.contentHash,
        immutable: decoded.immutable,
        attestationUid: att.id,
        txHash: att.txid,
        attester: att.attester,
        timestamp: att.time,
        parent: decoded.parent && decoded.parent !== '0x0000000000000000000000000000000000000000000000000000000000000000' 
          ? decoded.parent : null,
      };
      sectionOrder.push(sectionId);

      // Track root (preamble or first section without parent)
      if (!rootAttestation && (!decoded.parent || decoded.parent === '0x0000000000000000000000000000000000000000000000000000000000000000')) {
        rootAttestation = att;
      }
    }

    // Resolve parent relationships (UID -> sectionId)
    const uidToSection = {};
    for (const [id, section] of Object.entries(sections)) {
      uidToSection[section.attestationUid] = id;
    }
    for (const section of Object.values(sections)) {
      if (section.parent && uidToSection[section.parent]) {
        section.parent = uidToSection[section.parent];
      } else {
        section.parent = null;
      }
    }

    // Build children arrays
    for (const section of Object.values(sections)) {
      if (section.parent && sections[section.parent]) {
        if (!sections[section.parent].children) {
          sections[section.parent].children = [];
        }
        sections[section.parent].children.push(section.id);
      }
    }

    return {
      meta: {
        version: 1,
        versionLabel: 'v1.0 Genesis',
        chainId,
        schemaUid: config.schemaUid,
        attestationUid: rootAttestation?.id,
        deployedAt: rootAttestation ? new Date(rootAttestation.time * 1000).toISOString() : null,
        source: 'eas',
      },
      sections,
      sectionOrder,
      config, // Include EAS config for links
    };
  } catch (e) {
    console.error('Failed to fetch from EAS:', e);
    return null;
  }
}

// Main loader - tries EAS first, falls back to mock
async function loadCLMData(chainId = 84532) {
  // First try to load deployment info
  await loadDeploymentInfo();
  
  // Try EAS
  const easData = await fetchCLMFromEAS(chainId);
  if (easData) {
    return easData;
  }

  // Fall back to mock data
  console.log('Using mock CLM data');
  if (typeof CLM_DATA !== 'undefined') {
    return {
      ...CLM_DATA,
      meta: {
        ...CLM_DATA.meta,
        source: 'mock',
      },
      config: EAS_CONFIG[chainId] || EAS_CONFIG[84532],
    };
  }

  throw new Error('No CLM data available');
}

// Export for use in constitution.html
window.EAS_CONFIG = EAS_CONFIG;
window.loadCLMData = loadCLMData;
window.loadDeploymentInfo = loadDeploymentInfo;
