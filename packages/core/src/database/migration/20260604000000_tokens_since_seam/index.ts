import { Database } from "../../database"
export const migrate = (db: Database.Database) => db.run("SELECT 1")
