// import { ClobClient } from "@polymarket/clob-client";
// import { Wallet } from "ethers";

// const HOST = "https://clob.polymarket.com";
// const CHAIN_ID = 137; // Polygon mainnet
// const privateKey = "0xd2f0dc72e02988fcac32abbb83bc004d86aed1e64c796717531d030ae7a54b76";
// const signer = new Wallet(privateKey);

// const client = new ClobClient(
//   HOST,
//   CHAIN_ID,
//   signer
// );

// // Gets API key, or else creates
// const apiCreds = await client.createOrDeriveApiKey();
// console.log("apiCreds =", JSON.stringify(apiCreds, null, 2));

// /*
// apiCreds = {
//   "apiKey": "550e8400-e29b-41d4-a716-446655440000",
//   "secret": "base64EncodedSecretString",
//   "passphrase": "randomPassphraseString"
// }
// */