// frontend/src/types/index.ts
export interface Prediction {
    account_id: string;
    fraud_type: string;
    confidence: number;
    prediction_vector: number[];
    timestamp: string;
    actor: string | null;
    branch: string | null;
    window_start: string | null;
    window_end: string | null;
    txn_count: number | null;
  }
  export interface PredictionList { items: Prediction[]; total: number; }
  
  export interface TxnRow {
    amount: number;
    channel: string | null;
    timestamp: string;
    direction: string | null;
    counterparty: string | null;
  }
  export interface PredictionDetail {
    prediction: Prediction;
    transactions: TxnRow[];
    occupation: string | null;
    declared_income: number | null;
    customer_since: string | null;
    account_status: string | null;
    account_type: string | null;
  }
  
  export interface AccountSummary {
    account_id: string;
    account_type: string | null;
    status: string | null;
    branch: string | null;
    actor: string | null;
  }
  export interface AccountList { items: AccountSummary[]; total: number; }
  export interface AccountDetail {
    account_id: string;
    account_type: string | null;
    status: string | null;
    created_date: string | null;
    actor: string | null;
    occupation: string | null;
    declared_income: number | null;
    customer_since: string | null;
    branch: string | null;
    city: string | null;
    region: string | null;
    transactions: TxnRow[];
    total_in: number;
    total_out: number;
  }
  
  export const FRAUD_CLASSES = [
    "Normal", "Structuring", "Dormant",
    "Velocity Spike", "Sleeping Beauty", "Micro+Drain",
  ] as const;