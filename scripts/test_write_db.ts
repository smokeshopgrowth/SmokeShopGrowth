import { db } from "../src/db";
import { leads } from "../src/db/schema";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Testing database insertion...");

  try {
    const result = await db.insert(leads).values({
      name: "Test Business 123",
      address: "123 Test St, Test City, TS 12345",
      phone: "+1 555-0123",
      website: "https://example.com/test",
      rating: "4.5",
      reviews: "100",
      industry: "Test Industry",
      emails: "test@example.com",
      status: "new",
      notes: "Test lead created from test script",
    }).returning();

    console.log("Successfully inserted test lead:");
    console.log(result);
  } catch (error) {
    console.error("Error inserting test lead:", error);
  } finally {
    process.exit(0);
  }
}

main().catch(console.error);
