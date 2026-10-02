import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_CONFIG } from './config';
import type { AppConfig } from './config';
import { DatabaseService } from './database/database.service';
import { HealthController } from './health/health.controller';
import { LivenessService } from './health/liveness.service';
import { AuthGuard } from './identity/auth.guard';
import { IdentityController } from './identity/identity.controller';
import { IdentityRepository } from './identity/identity.repository';
import { GovernanceController } from './governance/governance.controller';
import { GovernanceService } from './governance/governance.service';
import { InvitationController } from './governance/invitation.controller';
import { InvitationService } from './governance/invitation.service';
import { InvitationWorker } from './governance/invitation.worker';
import { InvitationAuthAdapter } from './governance/invitation-auth.adapter';
import { AcademicController } from './academic/academic.controller';
import { AcademicService } from './academic/academic.service';
import { ContentController } from './content/content.controller';
import { ContentService } from './content/content.service';
import { ActivitiesController } from './activities/activities.controller';
import { ActivitiesService } from './activities/activities.service';
import { PracticeController } from './practice/practice.controller';
import { PracticeService } from './practice/practice.service';
import { PracticeRepository } from './practice/practice.repository';
import { PracticeReconciler } from './practice/practice.reconciler';
import { ExecutionPort } from './practice/execution.port';
import { DockerExecutionAdapter } from './practice/docker-execution.adapter';
import { SubmissionController } from './practice/submission.controller';
import { SubmissionService } from './practice/submission.service';
import { SubmissionRepository } from './practice/submission.repository';
import { SubmissionReconciler } from './practice/submission.reconciler';
import {
  MaterialsController,
  MaterialUploadGuard,
} from './materials/materials.controller';
import { MaterialsService } from './materials/materials.service';
import { MaterialsRepository } from './materials/materials.repository';
import { MaterialsWorker } from './materials/materials.worker';
import {
  MATERIALS_STORAGE,
  MATERIALS_EMBEDDINGS,
} from './materials/materials.ports';
import { SupabaseMaterialsStorage } from './materials/storage.adapter';
import {
  AzureEmbeddingsAdapter,
  AzureHelpAdapter,
  verifiedHelpEvidencePolicyFromArtifact,
  HELP_QUERY_VERSION,
  TOKENIZER_VERSION,
} from '@alunza/ai';
import type { EmbeddingsPort } from '@alunza/ai';
import { HelpController } from './help/help.controller';
import { HelpService } from './help/help.service';
import { HelpRepository } from './help/help.repository';
import { HelpWorker } from './help/help.worker';
import {
  HELP_PROVIDER_FACTORY,
  productionHelpFactory,
} from './help/help.ports';
import type { HelpProviderFactory } from './help/help.ports';
import { SubmissionExecutionPort } from './practice/submission-execution.port';
import { DockerSubmissionAdapter } from './practice/docker-submission.adapter';
import { EvaluationGateway } from './evaluation/evaluation.gateway';
import { EvaluationRepository } from './evaluation/evaluation.repository';
import { EvaluationOperations } from './evaluation/evaluation.operations';
import { EVALUATION_CONFIG } from './evaluation/evaluation.types';
import {
  EvaluationCalibrationWorker,
  CALIBRATION_PROVIDER_FACTORY,
} from './evaluation-calibration/evaluation-calibration.worker';
import { evaluationProviderProfile } from './evaluation-profiles';
import {
  JWT_KEY_RESOLVER,
  JwtVerifier,
  remoteKeyResolver,
} from './identity/jwt-verifier';

@Module({})
export class AppModule {
  static register(
    config: AppConfig,
    testEmbeddings?: EmbeddingsPort,
    testHelpFactory?: HelpProviderFactory,
  ): DynamicModule {
    if ((testEmbeddings || testHelpFactory) && config.environment !== 'test')
      throw new Error('Test providers require TEST.');
    return {
      module: AppModule,
      controllers: [
        HealthController,
        IdentityController,
        GovernanceController,
        InvitationController,
        AcademicController,
        ContentController,
        ActivitiesController,
        PracticeController,
        SubmissionController,
        MaterialsController,
        HelpController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: JWT_KEY_RESOLVER,
          useFactory: remoteKeyResolver,
          inject: [APP_CONFIG],
        },
        DatabaseService,
        {
          provide: EVALUATION_CONFIG,
          useValue: config.evaluation ?? {
            enabled: false,
            operationsPort: 4401,
          },
        },
        EvaluationRepository,
        EvaluationGateway,
        EvaluationOperations,
        EvaluationCalibrationWorker,
        {
          provide: CALIBRATION_PROVIDER_FACTORY,
          useValue: () => {
            const embeddings =
              testEmbeddings ??
              (config.azureEmbeddingConfiguration
                ? new AzureEmbeddingsAdapter(config.azureEmbeddingConfiguration)
                : null);
            if (!embeddings) return null;
            // The TEST factory remains explicit; production uses the separately
            // configured verifier even before help is enabled by calibration.
            const test = testHelpFactory?.();
            if (test instanceof Promise)
              throw new Error('Calibration TEST factory must be synchronous.');
            return {
              embeddings,
              embeddingFingerprint: evaluationProviderProfile(
                config,
                'EMBEDDING',
                embeddings.configuration,
              ).fingerprint,
              verification:
                test?.verification ??
                (config.azureGenerationConfiguration
                  ? new AzureHelpAdapter(config.azureGenerationConfiguration)
                  : undefined),
              verificationProfile: evaluationProviderProfile(config, 'REVIEW', {
                id: test?.configurationId ?? 'unconfigured',
                model: 'test-fixture-only',
              }),
              tokenizer:
                test?.tokenizer ??
                config.azureGenerationConfiguration?.tokenizer,
            };
          },
        },
        LivenessService,
        JwtVerifier,
        AuthGuard,
        IdentityRepository,
        GovernanceService,
        InvitationService,
        InvitationAuthAdapter,
        InvitationWorker,
        AcademicService,
        ContentService,
        ActivitiesService,
        PracticeRepository,
        PracticeService,
        PracticeReconciler,
        { provide: ExecutionPort, useClass: DockerExecutionAdapter },
        SubmissionRepository,
        SubmissionService,
        SubmissionReconciler,
        MaterialsRepository,
        MaterialUploadGuard,
        MaterialsService,
        MaterialsWorker,
        HelpRepository,
        HelpService,
        HelpWorker,
        {
          provide: HELP_PROVIDER_FACTORY,
          inject: [EvaluationRepository],
          useFactory: (
            evaluation: EvaluationRepository,
          ): HelpProviderFactory => {
            if (testHelpFactory && !config.evaluation?.enabled)
              return testHelpFactory;
            return async () => {
              const artifact = config.helpCalibration;
              if (
                !artifact ||
                artifact.version !== 'help-evidence-2' ||
                !config.helpCalibrationCorpusHash
              )
                return null;
              const providers = testHelpFactory
                ? await testHelpFactory()
                : null;
              if (testHelpFactory && !providers) return null;
              if (!providers && !config.azureEmbeddingConfiguration)
                return null;
              const embeddingProfile = evaluationProviderProfile(
                config,
                'EMBEDDING',
                providers?.embeddings.configuration ?? { id: '', model: '' },
              );
              const trustedHash = await evaluation.assertCalibration(
                artifact,
                !!testHelpFactory && config.environment === 'test',
                embeddingProfile.fingerprint,
              );
              if (!trustedHash) return null;
              if (!testHelpFactory)
                return productionHelpFactory(config, trustedHash)();
              if (!providers) return null;
              return {
                ...providers,
                evidence: verifiedHelpEvidencePolicyFromArtifact(
                  artifact,
                  {
                    configurationId: providers.embeddings.configuration.id,
                    embeddingModel: providers.embeddings.configuration.model,
                    dimensions: providers.embeddings.configuration.dimensions,
                    tokenizerVersion: TOKENIZER_VERSION,
                    queryVersion: HELP_QUERY_VERSION,
                    corpusHash: config.helpCalibrationCorpusHash,
                  },
                  trustedHash,
                  { allowTest: true },
                ),
              };
            };
          },
        },
        { provide: MATERIALS_STORAGE, useClass: SupabaseMaterialsStorage },
        {
          provide: MATERIALS_EMBEDDINGS,
          useFactory: () =>
            testEmbeddings ??
            (config.azureEmbeddingConfiguration
              ? new AzureEmbeddingsAdapter(config.azureEmbeddingConfiguration)
              : null),
        },
        { provide: SubmissionExecutionPort, useClass: DockerSubmissionAdapter },
      ],
    };
  }
}
