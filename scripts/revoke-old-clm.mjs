#!/usr/bin/env node
/**
 * Revoke old CLM attestations with broken parent UIDs
 */

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import fs from 'fs';
import path from 'path';

const EAS_CONTRACT = '0x4200000000000000000000000000000000000021';
const SCHEMA_UID = '0xcac2a4177f75d29f7fef657aa221e510d888785ed7b1b2d16497ae839928fb05';

// Old attestation UIDs to revoke
const OLD_UIDS = [
  '0x9a4398226fc21627fca3912c0cf2216da4c8af2ae0d0e8d90009c634a9ad3264',
  '0xacd6993be24f587f32b2ad3b5723ff0683e8ba182e89a712c64a17dad2a1ae17',
  '0xbb94038ec2dee2fffa817da18f3339b267bb24f7416b07d50b5bb692165d4f43',
  '0x4e9b870993f97064ae03e10fc649d5cf29cd2e3bde1f8e9d0c379e6026270ee8',
  '0x031f71eb8eb551f33e86c5e81a38113665ee75d0cea0b96fe50341142f9dba8e',
  '0x55a6784d53cb05d2a58446dda9da090f358177c1234cde02d46e84c4bb4c1d67',
  '0xe6c13ece51bff0566e429b9b5ecbd1681408a36b6ba5ed7fd451c363f50bc78a',
  '0x6bd48fe692671233b6421ce89a0f74e937841179409d598b54a73a8940ffdf26',
  '0x5b5f0d51032a7b06fafa537674ad516b314babfa284460c9da250998b0109175',
  '0xf425f0a4ea06deb20946312b8c18f813c9f4ce562d20f9465de08e83755c09d0',
  '0xc9f5f567e25a09fa882dd707f61a28abd9dc57afdf76ad80808df93bdea59e8d',
  '0xdd42650d4f4ebb9bc533e73736adac4ec8f943525b51109bc20f292f63e58073',
  '0xff66317070e415564e82c5b342552e78b19371b4ac22d184e3acb9e77e2722fa',
  '0x61d3aaa42fd3b0f2dd5a2176494c6dbe26594143de8381a81abcba0f3c972b05',
  '0xf85bdac43debf9b71a25cbd8556359d8786f266f7df085a92cc1f39e7d87fb30',
  '0x9eced8f83d788d61f03c6db627cc203d2f6af64c70801aa5851c3d5d1a27823c',
  '0x30afb6894484b9b4a67d67157502732af01436f504732288874ae4cc0f4169d0',
  '0x829796e0bf8302630d30f4b3a1cce77fc4a447586c3dbbce0f0850752d285ed8',
  '0xddd9ac7a5d09bdc4e58152b7c81d47c67ea876dc94daec2dd88d55ae087a8996',
  '0xfe3d2c081e7910a82ce140aa5a13b553a699ffe2fd4f39082e6f1c702bef3d27',
  '0x9c5d6beb4da567a60dab64d835bd366678396ed26436056c79c41faad4098357',
  '0xf98ef25e931f727a4b53b1e05a9cbdce797273c5214bb311fd8a5dd0aa09ad64',
  '0x426d582f1ee89385b636110f8f5fea5175f1bdb0f16b3fdd49c213443b806279',
  '0xbe96edff5c9dce7a75c5133a5036a7d161bc4f7a0c0660db4d5f3f4f8a9f854c',
  '0x92002014fc9cfa3959c3342f262607a319da8ba1992b6722a6efce3504b35a30',
  '0x7008d5767efe010aaa857d18d624c77d22a7080e0a80829a7dd2eb97c55d9a6b',
  '0x49fdc51e777943d7d5db73684c7594f3ebaf9825d685ef58a2ea33bfea027758',
  '0x2039b5906fbfac28bbfdd8de64a926dc7ea7e8b04b568e70f6d1695e257c6ba4',
  '0x105e50a71951081db832545841b9222dc7c36ff87f39964d6b58d423ef92e255',
  '0x72c373f6564b1b3dc83fc731266c8647ebb14276423110abad3e73a716db3c29',
  '0x6b35c441d1ccaea36395cc30eb570c473b3747450cc4446e59c777e9d648f368',
  '0x53fcde31e4f0e7b46b60f36ac6f3dff77e44257c0c118f6d54607931176ff8a1',
  '0xe5e91f7cf616103e5eb22dd272ab7a72babcb56f3306a5b648277ca0f6a60c4f',
  '0x2aadab9d85c70920e3388d6ca0b9ecfaa9391035039201e5fe56abe53e20d64e',
  '0xb91623f2686916eb71fb9ae5262968e76795737e9ccb681de3b0d2193857a1c7',
  '0x19c08a92d37288d6fbeae5c52dd6a5a146d178d697a81d0dcbecf9096be12716',
  '0x9951b6e767fd4a2b8f080fa7bc41454cb7176b40f5b521559257b80b08f3800c',
  '0xce599a228e10a1c734661a2b3e3bf538e0c25fa1a47083882bb94df7c6164116',
  '0x3af924873ff1f1e86c27e39054b172daba278c061b67c412bd6feaa88b64d5da',
];

const EAS_ABI = [
  {
    name: 'revoke',
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
              { name: 'uid', type: 'bytes32' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
];

async function main() {
  // Load private key
  const secretsPath = path.join(process.env.HOME, '.openclaw/secrets/keypairs.json');
  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  const privateKey = secrets['cyberstorm-deployer'].privateKey;
  
  const account = privateKeyToAccount(privateKey);
  
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });
  
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  console.log('Revoking old CLM attestations');
  console.log('==============================');
  console.log(`Revoker: ${account.address}`);
  console.log(`Attestations to revoke: ${OLD_UIDS.length}`);
  console.log('');

  for (let i = 0; i < OLD_UIDS.length; i++) {
    const uid = OLD_UIDS[i];
    console.log(`Revoking ${i + 1}/${OLD_UIDS.length}: ${uid.slice(0, 18)}...`);
    
    try {
      const hash = await walletClient.writeContract({
        address: EAS_CONTRACT,
        abi: EAS_ABI,
        functionName: 'revoke',
        args: [{
          schema: SCHEMA_UID,
          data: {
            uid: uid,
            value: 0n,
          },
        }],
      });
      
      console.log(`  Tx: ${hash}`);
      
      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ Revoked`);
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
    }
  }

  console.log('');
  console.log(`✓ Revoked ${OLD_UIDS.length} attestations`);
}

main().catch(console.error);
