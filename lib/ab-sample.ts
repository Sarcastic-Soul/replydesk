import type { AbPair } from "./types";

// Sample pairs for offline mode. "base" mimics how a prompted base model tends to
// write (long, formal); "tuned" is a short owner-style reply. Written by hand,
// not model output. Real pairs come from the eval run.
export const SAMPLE_AB_PAIRS: AbPair[] = [
  {
    id: "s1", author: "Rohan M.", rating: 2,
    reviewText: "Car was ready a day late and nobody called to tell me. Work itself was fine, brakes feel good now, but I had to take leave twice.",
    base: "Dear Rohan, thank you for taking the time to share your feedback. We sincerely apologize for any inconvenience caused by the delay in your vehicle's completion. We value your business and are committed to providing the best possible service. Please do not hesitate to contact us if there is anything further we can do.",
    tuned: "Rohan, you're right, we should have called the moment the part got delayed. Sorry you had to take leave twice. Glad the brakes feel good now. — Ganesh",
  },
  {
    id: "s2", author: "Ankit P.", rating: 1,
    reviewText: "Charged ₹800 for a check that took five minutes.",
    base: "Dear Valued Customer, we are truly sorry to hear that your experience did not meet your expectations. Customer satisfaction is our highest priority and we would like to understand your concerns better. Kindly reach out to our team so that we may address this matter at the earliest.",
    tuned: "Ankit, that is a fair thing to question. Call me and I'll go through the bill with you. — Ganesh",
  },
  {
    id: "s3", author: "Meera K.", rating: 4,
    reviewText: "Good service, the waiting area could be cleaner.",
    base: "Thank you so much for your wonderful review and for choosing our garage! We are delighted that you enjoyed our service. We appreciate your feedback regarding the waiting area and will definitely take it into consideration as we continuously strive to improve.",
    tuned: "Thanks Meera. You're right about the waiting area, we'll sort it this week. — Ganesh",
  },
  {
    id: "s4", author: "Priya S.", rating: 5,
    reviewText: "Ramesh bhai fixed the AC in under an hour. Honest price, showed me the old part.",
    base: "Thank you for your kind words, Priya! We are thrilled to hear about your positive experience with our team. Your satisfaction is the greatest reward for us and we look forward to serving you again in the future. Have a wonderful day!",
    tuned: "Thank you Priya, I'll tell Ramesh. See you next time. — Ganesh",
  },
  {
    id: "s5", author: "David L.", rating: 5,
    reviewText: "Got me back on the road on a Sunday. Lifesavers.",
    base: "We greatly appreciate your fantastic five-star review, David! Our team is dedicated to ensuring that every customer receives prompt and professional service, even on weekends. Thank you for choosing us and we hope to see you again!",
    tuned: "Glad we could help, David. Sundays are for emergencies. Drive safe. — Ganesh",
  },
];
