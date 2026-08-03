/**
 * In-process MQTT test broker for the Playwright harness (E10-T1, flow 8).
 *
 * DELIBERATE DEVIATION from docs/07 §5 flow 8's literal wording
 * ("mosquitto-Testcontainer"), and the SAME deviation the Core's own MQTT
 * integration tests already document and justify at length -- see the header
 * of `apps/core/src/mqtt/bridge.integration.test.ts`: this repo's CI has no
 * broker service and no testcontainers infrastructure, so a REAL `aedes`
 * broker (a pure-Node MQTT broker library) is run in-process on a real
 * loopback TCP port instead. Nothing about MQTT itself is mocked: the Core
 * connects with the real `mqtt.js` client over a real socket, and the spec's
 * observer client is a second real `mqtt.js` client, exactly what a real Home
 * Assistant MQTT integration would be.
 *
 * Started from `globalSetup.ts` BEFORE the flow-8 Core boots (unlike the
 * Valhalla/registry stubs, which the specs own): `MqttBridge` reconnects with
 * exponential backoff capped at 60 s, so a broker that only appears once the
 * spec starts could leave the bridge parked in a long backoff for most of the
 * run. Having the broker up first makes the bridge connect on its first try.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { Aedes } from 'aedes';

export interface TestBroker {
  port: number;
  close(): Promise<void>;
}

/** Starts a real aedes broker listening on `port` (loopback only). */
export async function startTestBroker(port: number): Promise<TestBroker> {
  const broker = await Aedes.createBroker();
  const server: Server = createServer(broker.handle);
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => broker.close(() => resolve()));
    },
  };
}
