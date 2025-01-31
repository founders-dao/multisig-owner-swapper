import { createPublicClient, http } from "viem";
import { apeChain, arbitrum, arbitrumNova, base, mainnet } from "viem/chains";
import { SAFE_ABI } from "./safe.abi";
import { addChecksum } from "./checksum";
import fs from 'fs';

const SAFE = "0x71e75d2f6d7048b8417fdabad1ed87376334ff14";
const NEW_OWNERS = [
  "0xc8edCa953BbC3211F5bC947e9CceB296a9900D6D",
  "0x0000000000000000000000000000000000000002", // Cannot use 0x1 for placeholder, its the sentinel address
  "0x0000000000000000000000000000000000000003",
  "0xFd25Dc31196c73E15eDE57391c32472193147FF5",
  "0x0000000000000000000000000000000000000004",
  "0x0000000000000000000000000000000000000005",
  "0x0000000000000000000000000000000000000006"
].map(a => a.toLowerCase()) // This is test data, please replace with actual data
const CHAINS = [mainnet, arbitrum, arbitrumNova, apeChain, base];

const SENTINEL_ADDRESS = "0x0000000000000000000000000000000000000001";

// Our test data emulates this situation:
// 1. The SAFE has 7 owners
// 2. 5 of the owners are changing their address
// 3. 2 owner is not changing their address

// OLD_OWNERS:
/*
const OLD_OWNERS = [
  "0xc8edCa953BbC3211F5bC947e9CceB296a9900D6D",
  "0xf06094bD89E272A3E1b6fD446F3f126C97Ef04AC",
  "0x6bc3F31254DF16e362C81eF1d00e40Aa98ada4C1",
  "0xFd25Dc31196c73E15eDE57391c32472193147FF5",
  "0x10316BEc523d5Cf7321e51d6A27B365366C1b387",
  "0x3F8b55Efa76AF49372Efe2224029efCBCbC3B71f",
  "0x115Ab9e1dBe84030719835dd3d4B74503BE8921B"
]
*/

CHAINS.forEach(async (chain) => {
  const client = createPublicClient({
    transport: http(chain.rpcUrls.default[0]),
     chain,
  });
  const currentOwners = (await client.readContract({
    address: SAFE,
    abi: SAFE_ABI,
    functionName: "getOwners"
  })).map(a => a.toLowerCase());

  const threshold = (await client.readContract({
    address: SAFE,
    abi: SAFE_ABI,
    functionName: "getThreshold"
  }));

/*
    {
      "to": "0x580A96BC816C2324Bdff5eb2a7E159AE7ee63022",
      "value": "0",
      "data": null,
      "contractMethod": {
        "inputs": [
          { "internalType": "address", "name": "prevOwner", "type": "address" },
          { "internalType": "address", "name": "owner", "type": "address" },
          { "internalType": "uint256", "name": "_threshold", "type": "uint256" }
        ],
        "name": "removeOwner",
        "payable": false
      },
      "contractInputsValues": {
        "prevOwner": "0xFd25Dc31196c73E15eDE57391c32472193147FF5",
        "owner": "0x651EC1afd03C4A5F731dA8Fa4fc124802392b8dA",
        "_threshold": "4"
      }
    },
*/

  const ownersToRemove = currentOwners.filter(a => !NEW_OWNERS.includes(a)).sort((a, b) => currentOwners.indexOf(b) - currentOwners.indexOf(a));
  const ownersToAdd = NEW_OWNERS.filter(a => !currentOwners.includes(a));

  const removeOwnerAbi = SAFE_ABI.find(a => a.type === "function" && a.name === "removeOwner")!;
  const removeOwnerMethod = {
    inputs: removeOwnerAbi.inputs,
    name: removeOwnerAbi.name,
    payable: false
  };
  const transactionBase = {
    to: SAFE,
    value: "0",
    data: null,
  };

  const transactions: any[] = [];

  // We need to remove owners beginning from the end of the current list, to avoid changing the ordering
  for (const ownerToRemove of ownersToRemove) {
    const previousOwnerIndex = currentOwners.indexOf(ownerToRemove) - 1;
    let previousOwner;
    if (previousOwnerIndex < 0) {
      previousOwner = SENTINEL_ADDRESS;
    } else {
      previousOwner = currentOwners[currentOwners.indexOf(ownerToRemove) - 1];
    }

    const transaction = {
      ...transactionBase,
      contractMethod: removeOwnerMethod,
      contractInputsValues: {
        prevOwner: previousOwner,
        owner: ownerToRemove,
        _threshold: "1" // We temporarily set threshold to 1 to avoid error GS201 wherein threshold > owners in cases where swapping out >= threshold owners
      }
    };
    transactions.push(transaction);
  }

  const addOwnerAbi = SAFE_ABI.find(a => a.type === "function" && a.name === "addOwnerWithThreshold")!;
  const addOwnerMethod = {
    inputs: addOwnerAbi.inputs,
    name: addOwnerAbi.name,
    payable: false
  };
  for (const ownerToAdd of ownersToAdd) {
    const isLastOwner = ownersToAdd.indexOf(ownerToAdd) === ownersToAdd.length - 1;
    const transaction = {
      ...transactionBase,
      contractMethod: addOwnerMethod,
      contractInputsValues: {
        owner: ownerToAdd,
        _threshold: isLastOwner ? threshold.toString() : "1" // We set the threshold back here
      }
    };
    transactions.push(transaction);
  }

  const batch = addChecksum({
    version: "1.0",
    chainId: chain.id.toString(),
    createdAt: Date.now(),
    meta: {
      "name": "Transactions Batch (Owner swap)",
      "description": `Removes owners: [${ownersToRemove.join(", ")}] and adds [${ownersToAdd.join(", ")}]`,
      "txBuilderVersion": "1.17.1",
      "createdFromSafeAddress": SAFE,
      "createdFromOwnerAddress": "",
    },
    transactions
  });

  fs.writeFileSync(`./swap_owners_${chain.name}.json`, JSON.stringify(batch, null, 2));
})