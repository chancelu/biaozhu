export type CrawlJobStatus = "queued" | "running" | "paused" | "completed" | "failed";
export type LabelJobStatus = "queued" | "running" | "paused" | "completed" | "failed";
export type Grade = "S" | "A" | "B" | "C" | "D";

export interface CrawlJobRow {
  id: string;
  status: CrawlJobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  config_json: string;
  discovered_count: number;
  processed_count: number;
  failed_count: number;
  last_error: string | null;
}

export interface LabelJobRow {
  id: string;
  status: LabelJobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  config_json: string;
  total_count: number;
  processed_count: number;
  failed_count: number;
  last_error: string | null;
}

export interface ModelRow {
  id: string;
  url: string;
  title: string | null;
  author_name: string | null;
  download_count: number | null;
  cover_image_url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelImageRow {
  id: string;
  model_id: string;
  idx: number;
  url: string;
}

export interface ModelLabelRow {
  model_id: string;
  grade: Grade;
  reason: string;
  extracted_json: string;
  updated_at: string;
}

export interface Database {
  crawl_jobs: CrawlJobRow;
  label_jobs: LabelJobRow;
  models: ModelRow;
  model_images: ModelImageRow;
  model_labels: ModelLabelRow;
}

