require("dotenv").config();
const { sendFollowUp } = require("./follow_up");

console.log("Testing email follow-up system...");

sendFollowUp({
    business_name: "Test Smoke Shop",
    city: "Houston",
    outcome: "interested",
    contact_method: "email",
    contact_value: "roryulloa@gmail.com"
}).then(() => {
    console.log("Test finished.");
}).catch(err => {
    console.error("Test failed:", err);
});
