import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";

import {
  buildTelemetryMultipartUpload,
  fetchTelemetryIpAddress,
  normalizeTelemetryIpAddress,
  requireSuccessfulTelemetryUpload
} from "../lib/telemetry-upload.js";

test("telemetry upload includes client, public wallet, full hostname, ip, and raw gzip", async () => {
  const clientId = "ab".repeat(32);
  const walletAddress = "11111111111111111111111111111111";
  const payload = {
    schemaVersion: "veilance.telemetry-snapshot.v2",
    eventId: "snapshot-event-1",
    site: { hostname: "collector.shop.example.co.uk", https: true },
    redactedDocument: { html: "<!doctype html><html></html>" }
  };
  const request = await buildTelemetryMultipartUpload({
    records: [{ payload }],
    clientId,
    walletAddress,
    batchId: "batch-id-1",
    ipAddress: "203.0.113.42"
  });

  assert.ok(request.body instanceof FormData);
  assert.deepEqual(
    [...request.body.keys()],
    ["client_id", "wallet_address", "domain_name", "ip_address", "telemetry"]
  );
  assert.equal(request.body.get("client_id"), clientId);
  assert.equal(request.body.get("wallet_address"), walletAddress);
  assert.equal(request.body.get("domain_name"), "collector.shop.example.co.uk");
  assert.equal(request.body.get("ip_address"), "203.0.113.42");

  const telemetryFile = request.body.get("telemetry");
  assert.equal(telemetryFile.name, "telemetry.bin");
  assert.equal(telemetryFile.type, "application/gzip");
  const gzipBytes = new Uint8Array(await telemetryFile.arrayBuffer());
  assert.equal(gzipBytes[0], 0x1f);
  assert.equal(gzipBytes[1], 0x8b);

  const envelope = JSON.parse(gunzipSync(gzipBytes).toString("utf8"));
  assert.equal(envelope.schemaVersion, "veilance.telemetry-snapshot-batch.v1");
  assert.equal(envelope.batchId, "batch-id-1");
  assert.equal(envelope.contributorId, clientId);
  assert.deepEqual(envelope.observations, [payload]);
});

test("telemetry IP lookup uses the Veilance endpoint and validates IPv4 and IPv6", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      error: {},
      output: { ip_address: "203.0.113.42" }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const ipv4 = await fetchTelemetryIpAddress({
    endpoint: "https://api.veilance.org/api/v1/telemetry/ip",
    fetchImpl
  });
  assert.equal(ipv4, "203.0.113.42");
  assert.equal(request.url, "https://api.veilance.org/api/v1/telemetry/ip");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.referrerPolicy, "no-referrer");

  const ipv6 = await fetchTelemetryIpAddress({
    endpoint: "https://api.veilance.org/api/v1/telemetry/ip",
    fetchImpl: async () => new Response(JSON.stringify({
      output: { ip_address: "2001:DB8::7" }
    }), { status: 200 })
  });
  assert.equal(ipv6, "2001:db8::7");
  assert.equal(normalizeTelemetryIpAddress("192.0.2.19"), "192.0.2.19");
  assert.equal(normalizeTelemetryIpAddress("[2001:db8::1]"), null);
  assert.equal(normalizeTelemetryIpAddress("192.168.001.1"), null);
  assert.equal(normalizeTelemetryIpAddress("example.com"), null);
});

test("telemetry IP lookup fails closed for HTTP errors and malformed addresses", async () => {
  await assert.rejects(
    fetchTelemetryIpAddress({
      endpoint: "https://api.veilance.org/api/v1/telemetry/ip",
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    }),
    /HTTP 503/
  );

  await assert.rejects(
    fetchTelemetryIpAddress({
      endpoint: "https://api.veilance.org/api/v1/telemetry/ip",
      fetchImpl: async () => new Response(JSON.stringify({
        output: { ip_address: "not-an-ip" }
      }), { status: 200 })
    }),
    /invalid IP address/i
  );
});

test("telemetry multipart creation rejects a missing or invalid IP address", async () => {
  const base = {
    records: [{ payload: { site: { hostname: "www.example.com" } } }],
    clientId: "ab".repeat(32),
    walletAddress: "11111111111111111111111111111111",
    batchId: "batch-id-1"
  };
  await assert.rejects(buildTelemetryMultipartUpload(base), /server-observed IP address/i);
  await assert.rejects(
    buildTelemetryMultipartUpload({ ...base, ipAddress: "localhost" }),
    /server-observed IP address/i
  );
});

test("telemetry upload requires a public wallet and one hostname per request", async () => {
  const records = [{ payload: { site: { hostname: "www.example.com" } } }];
  await assert.rejects(
    buildTelemetryMultipartUpload({
      records,
      clientId: "",
      walletAddress: "11111111111111111111111111111111",
      batchId: "batch-id-1"
    }),
    /valid telemetry client ID/i
  );

  await assert.rejects(
    buildTelemetryMultipartUpload({
      records,
      clientId: "ab".repeat(32),
      walletAddress: "not-a-wallet",
      batchId: "batch-id-1"
    }),
    /valid public Solana wallet address/i
  );

  await assert.rejects(
    buildTelemetryMultipartUpload({
      records: [
        ...records,
        { payload: { site: { hostname: "api.other.example" } } }
      ],
      clientId: "ab".repeat(32),
      walletAddress: "11111111111111111111111111111111",
      batchId: "batch-id-1"
    }),
    /different hostnames/i
  );

  await assert.rejects(
    buildTelemetryMultipartUpload({
      records: [{ payload: { site: { hostname: "www.example.com/private?q=secret" } } }],
      clientId: "ab".repeat(32),
      walletAddress: "11111111111111111111111111111111",
      batchId: "batch-id-1"
    }),
    /valid public hostname/i
  );
});

test("telemetry upload refuses to send uncompressed JSON as a gzip file", async () => {
  await assert.rejects(
    buildTelemetryMultipartUpload({
      records: [{ payload: { eventId: "snapshot-event-1" } }],
      clientId: "ab".repeat(32),
      walletAddress: "11111111111111111111111111111111",
      batchId: "batch-id-1",
      CompressionStreamClass: null
    }),
    /cannot create gzip telemetry uploads/i
  );
});

test("telemetry upload accepts only the API's output.ok success response", async () => {
  const report = await requireSuccessfulTelemetryUpload(new Response(JSON.stringify({
    error: {},
    metadata: { request_id: "req-test" },
    output: { ok: true }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
  assert.equal(report.output.ok, true);

  await assert.rejects(
    requireSuccessfulTelemetryUpload(new Response(JSON.stringify({
      error: { error_string: "Invalid telemetry data provided" },
      output: {}
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })),
    /Invalid telemetry data provided/
  );
});
