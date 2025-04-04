export {
  db,
  type CrudFactory,
  type FindByGameIdFactory,
  type FindByTeamGameIdFactory,
} from "./localdb";
export { seedDb } from "./seed";

// const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
