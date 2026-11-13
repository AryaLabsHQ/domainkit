import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";

export interface Pooled {
  /** Straight to Postgres, where every server session and its locks are visible. */
  readonly directUrl: string;
  /** Through PgBouncer in transaction mode, the way PlanetScale's pooled port serves a host. */
  readonly pooledUrl: string;
  readonly stop: () => Promise<unknown>;
}

/** Postgres behind PgBouncer in transaction mode, with a few server sessions to move between. */
export const startPooled = async (): Promise<Pooled> => {
  // Stopped newest first, including when a later container fails to start.
  const started: Array<() => Promise<unknown>> = [];
  const stop = () =>
    started
      .splice(0)
      .reverse()
      .reduce<Promise<unknown>>((previous, close) => previous.then(close), Promise.resolve());
  try {
    const network: StartedNetwork = await new Network().start();
    started.push(() => network.stop());
    const postgres: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
      .withNetwork(network)
      .withNetworkAliases("postgres")
      .withDatabase("domainkit")
      .withUsername("domainkit")
      .withPassword("domainkit")
      .start();
    started.push(() => postgres.stop());
    const bouncer: StartedTestContainer = await new GenericContainer("edoburu/pgbouncer:v1.24.1-p1")
      .withNetwork(network)
      .withEnvironment({
        DATABASE_URL: "postgres://domainkit:domainkit@postgres:5432/domainkit",
        POOL_MODE: "transaction",
        AUTH_TYPE: "scram-sha-256",
        DEFAULT_POOL_SIZE: "4",
        LISTEN_PORT: "6432",
      })
      .withExposedPorts(6432)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    started.push(() => bouncer.stop());
    return {
      directUrl: postgres.getConnectionUri(),
      pooledUrl: `postgres://domainkit:domainkit@${bouncer.getHost()}:${bouncer.getMappedPort(6432)}/domainkit`,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
};
