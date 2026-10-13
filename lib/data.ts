import "server-only";
import * as mock from "./data-mock";
import * as db from "./data-db";

// One switch: DATABASE_URL set -> Postgres (Tiger), otherwise the in-memory sample store.
const impl: typeof mock = process.env.DATABASE_URL ? db : mock;

export const listReviews = () => impl.listReviews();
export const getReview = (...a: Parameters<typeof mock.getReview>) => impl.getReview(...a);
export const addReview = (...a: Parameters<typeof mock.addReview>) => impl.addReview(...a);
export const importCsv = (...a: Parameters<typeof mock.importCsv>) => impl.importCsv(...a);
export const markSent = (...a: Parameters<typeof mock.markSent>) => impl.markSent(...a);
export const getShop = () => impl.getShop();
export const saveShop = (...a: Parameters<typeof mock.saveShop>) => impl.saveShop(...a);
export const findSimilarReplies = (...a: Parameters<typeof mock.findSimilarReplies>) => impl.findSimilarReplies(...a);
export const getEvalResults = () => impl.getEvalResults();
export const getAbPairs = () => impl.getAbPairs();
export const saveVote = (...a: Parameters<typeof mock.saveVote>) => impl.saveVote(...a);
