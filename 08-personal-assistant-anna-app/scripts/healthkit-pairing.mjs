import { randomBytes } from "node:crypto";
import os from "node:os";

const port = Number(process.env.PORT || 8808);
const token = process.env.HEALTHKIT_BRIDGE_TOKEN || randomBytes(24).toString("base64url");
const addresses = lanAddresses();

if (addresses.length === 0) {
  console.log("No LAN IPv4 address detected. Connect this Mac and iPhone to the same network, then rerun.");
  process.exit(0);
}

console.log("Anna HealthKit bridge pairing");
console.log("");
console.log("Start Anna bridge on this Mac:");
console.log(`HOST=0.0.0.0 PORT=${port} HEALTHKIT_BRIDGE_TOKEN=${shellQuote(token)} npm run serve`);
console.log("");
console.log("Enter one of these Bridge URLs in the iPhone companion:");
for (const item of addresses) {
  console.log(`- http://${item.address}:${port}/api/healthkit/snapshot (${item.name})`);
}
console.log("");
console.log("Or open one of these Pairing Links on the iPhone after installing the companion:");
for (const item of addresses) {
  const bridgeUrl = `http://${item.address}:${port}/api/healthkit/snapshot`;
  console.log(`- ${pairingLink(bridgeUrl, token)} (${item.name})`);
}
console.log("");
console.log("Bridge Token:");
console.log(token);
console.log("");
console.log("Keep this token private. Anyone on the same network with this token can push a health snapshot to this local bridge.");

function lanAddresses() {
  const results = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      if (!isPrivateLanAddress(entry.address)) continue;
      results.push({ name, address: entry.address });
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function isPrivateLanAddress(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function pairingLink(bridgeUrl, bridgeToken) {
  const params = new URLSearchParams({
    bridge_url: bridgeUrl,
    token: bridgeToken
  });
  return `anna-healthkit://pair?${params.toString()}`;
}
