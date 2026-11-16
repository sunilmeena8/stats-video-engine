import type {
  BarChartRaceConfig,
  PublicRaceConfig,
  CreateProjectRequest,
  JobDetailResponse,
  ProjectDetailResponse,
  RenderJobEvent,
  RenderManifest,
  RenderProgress,
  RenderMetadata,
  RenderRequest,
  RenderRequestDetailResponse,
  DashboardStats,
  OutputListItem,
  Topic,
  UpdateProjectRequest,
  User,
  CreateDatasetRequest,
  DataPoint,
  DatasetDetailResponse,
  DatasetListResponse,
  DatasetPreviewResponse,
  NormalizedDataset,
  ProcessingSummary,
  ValidationReport,
  DataSource,
  Dataset,
  DatasetEntity,
  DatasetVersion,
  HealthResponse,
  MediaAsset,
  RenderJob,
  RenderJobPayload,
  RenderJobResult,
  VideoConfiguration,
  VideoOutput,
  VideoProject,
  VideoTemplate,
} from '@statsopedia/shared-types';
import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type * as schemas from '../src/index.js';

// These assertions are enforced by `tsc --noEmit` (pnpm typecheck): if a schema and its
// shared type drift apart in either direction, type checking fails.
describe('schema ↔ shared type parity', () => {
  it('dataset contracts match', () => {
    expectTypeOf<z.output<typeof schemas.dataSourceSchema>>().toEqualTypeOf<DataSource>();
    expectTypeOf<z.output<typeof schemas.datasetSchema>>().toEqualTypeOf<Dataset>();
    expectTypeOf<z.output<typeof schemas.datasetVersionSchema>>().toEqualTypeOf<DatasetVersion>();
    expectTypeOf<z.output<typeof schemas.datasetEntitySchema>>().toEqualTypeOf<DatasetEntity>();
    expectTypeOf<z.output<typeof schemas.dataPointSchema>>().toEqualTypeOf<DataPoint>();
    expectTypeOf<
      z.output<typeof schemas.processingSummarySchema>
    >().toEqualTypeOf<ProcessingSummary>();
  });

  it('processing output and API contracts match', () => {
    expectTypeOf<
      z.output<typeof schemas.validationReportSchema>
    >().toEqualTypeOf<ValidationReport>();
    expectTypeOf<
      z.output<typeof schemas.normalizedDatasetSchema>
    >().toEqualTypeOf<NormalizedDataset>();
    expectTypeOf<
      z.input<typeof schemas.createDatasetRequestSchema>
    >().toEqualTypeOf<CreateDatasetRequest>();
    expectTypeOf<
      z.output<typeof schemas.datasetListResponseSchema>
    >().toEqualTypeOf<DatasetListResponse>();
    expectTypeOf<
      z.output<typeof schemas.datasetDetailResponseSchema>
    >().toEqualTypeOf<DatasetDetailResponse>();
    expectTypeOf<
      z.output<typeof schemas.datasetPreviewResponseSchema>
    >().toEqualTypeOf<DatasetPreviewResponse>();
  });

  it('video contracts match', () => {
    expectTypeOf<
      z.output<typeof schemas.videoConfigurationSchema>
    >().toEqualTypeOf<VideoConfiguration>();
    expectTypeOf<z.output<typeof schemas.videoTemplateSchema>>().toEqualTypeOf<VideoTemplate>();
    expectTypeOf<z.output<typeof schemas.videoProjectSchema>>().toEqualTypeOf<VideoProject>();
  });

  it('auth, project and job contracts match', () => {
    expectTypeOf<z.output<typeof schemas.userSchema>>().toEqualTypeOf<User>();
    expectTypeOf<z.output<typeof schemas.topicSchema>>().toEqualTypeOf<Topic>();
    expectTypeOf<z.output<typeof schemas.renderProgressSchema>>().toEqualTypeOf<RenderProgress>();
    expectTypeOf<z.output<typeof schemas.renderJobEventSchema>>().toEqualTypeOf<RenderJobEvent>();
    expectTypeOf<z.output<typeof schemas.renderManifestSchema>>().toEqualTypeOf<RenderManifest>();
    expectTypeOf<
      z.output<typeof schemas.updateProjectRequestSchema>
    >().toEqualTypeOf<UpdateProjectRequest>();
    // Partial<> yields `?: T` while Zod yields `?: T | undefined`: check assignability both ways.
    expectTypeOf<
      z.output<typeof schemas.createProjectRequestSchema>
    >().toExtend<CreateProjectRequest>();
    expectTypeOf<CreateProjectRequest>().toExtend<
      z.output<typeof schemas.createProjectRequestSchema>
    >();
    expectTypeOf<
      z.output<typeof schemas.projectDetailResponseSchema>
    >().toEqualTypeOf<ProjectDetailResponse>();
    expectTypeOf<
      z.output<typeof schemas.jobDetailResponseSchema>
    >().toEqualTypeOf<JobDetailResponse>();
  });

  it('bar chart race contracts match', () => {
    expectTypeOf<
      z.output<typeof schemas.barChartRaceConfigSchema>
    >().toEqualTypeOf<BarChartRaceConfig>();
    expectTypeOf<
      z.output<typeof schemas.publicRaceConfigSchema>
    >().toEqualTypeOf<PublicRaceConfig>();
  });

  it('render, media and health contracts match', () => {
    expectTypeOf<z.output<typeof schemas.renderJobSchema>>().toEqualTypeOf<RenderJob>();
    expectTypeOf<z.output<typeof schemas.renderRequestSchema>>().toEqualTypeOf<RenderRequest>();
    expectTypeOf<z.output<typeof schemas.dashboardStatsSchema>>().toEqualTypeOf<DashboardStats>();
    expectTypeOf<z.output<typeof schemas.outputListItemSchema>>().toEqualTypeOf<OutputListItem>();
    expectTypeOf<z.output<typeof schemas.renderMetadataSchema>>().toEqualTypeOf<RenderMetadata>();
    expectTypeOf<
      z.output<typeof schemas.renderRequestDetailResponseSchema>
    >().toEqualTypeOf<RenderRequestDetailResponse>();
    expectTypeOf<z.output<typeof schemas.videoOutputSchema>>().toEqualTypeOf<VideoOutput>();
    expectTypeOf<
      z.output<typeof schemas.renderJobPayloadSchema>
    >().toEqualTypeOf<RenderJobPayload>();
    expectTypeOf<z.output<typeof schemas.renderJobResultSchema>>().toEqualTypeOf<RenderJobResult>();
    expectTypeOf<z.output<typeof schemas.mediaAssetSchema>>().toEqualTypeOf<MediaAsset>();
    expectTypeOf<z.output<typeof schemas.healthResponseSchema>>().toEqualTypeOf<HealthResponse>();
  });
});
