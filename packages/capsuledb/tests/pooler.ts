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
  readonly stop: () => Promise<void>;
}

/** Postgres behind PgBouncer in transaction mode, with a few server sessions to move between. */
export const startPooled = async (): Promise<Pooled> => {
  const network: StartedNetwork = await new Network().start();
  const postgres: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .withDatabase("domainkit")
    .withUsername("domainkit")
    .withPassword("domainkit")
    .start();
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
  return {
    directUrl: postgres.getConnectionUri(),
    pooledUrl: `postgres://domainkit:domainkit@${bouncer.getHost()}:${bouncer.getMappedPort(6432)}/domainkit`,
    stop: async () => {
      await bouncer.stop();
      await postgres.stop();
      await network.stop();
    },
  };
};
