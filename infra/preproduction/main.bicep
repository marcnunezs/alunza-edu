targetScope = 'resourceGroup'

param location string = resourceGroup().location
param environmentName string
param registryName string
param identityName string
param apiName string
param jobName string
param webOrigin string
param authOrigin string
@minLength(40)
@maxLength(40)
param releaseId string
param approvedUntil string
@minValue(1)
@maxValue(265000)
param budgetClp int
// First deploy the registry/environment only, then push the tested digest and
// deploy workloads. Creating infrastructure never starts the manual Job.
param deployWorkloads bool = false
param deployJob bool = false
param apiImage string = ''
param jobImage string = ''
@secure()
param databaseUrl string = ''
@secure()
param databaseSslCa string = ''
@secure()
param jobManifest string = ''
@secure()
param vercelToken string = ''
@secure()
param aiAzureApiKey string = ''
@allowed(['api-key', 'managed-identity'])
param aiAuthMode string = 'managed-identity'
param aiResourceId string = ''
param aiEmbeddingModel string = ''
param aiGenerationModel string = ''
param aiConfigurationId string = ''
param sandboxImage string = ''
param sandboxRegion string = ''
param sandboxTeamId string = ''
param sandboxProjectId string = ''
@allowed(['probe:ai', 'probe:sandbox'])
param jobOperation string = 'probe:ai'
@minValue(60)
@maxValue(3640)
param jobTimeoutSeconds int = 3640

var tags = {
  project: 'alunza'
  environment: 'preproduction'
  release: releaseId
  approvedUntil: approvedUntil
  budgetCurrency: 'CLP'
  budgetClp: string(budgetClp)
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}
resource probeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${identityName}-probes'
  location: location
  tags: tags
}
resource pullPermission 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}
resource probePullPermission 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, probeIdentity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: probeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}
// The existing AI account is provisioned separately. Assign only inference rights
// to the probe identity; the API identity never receives AI permissions.
var aiResourceParts = split(empty(aiResourceId) ? resourceId('Microsoft.CognitiveServices/accounts', 'unused') : aiResourceId, '/')
module aiPermission './ai-permission.bicep' = if (deployWorkloads && deployJob && jobOperation == 'probe:ai' && aiAuthMode == 'managed-identity') {
  name: 'probe-ai-permission'
  scope: resourceGroup(aiResourceParts[2], aiResourceParts[4])
  params: {
    accountName: aiResourceParts[8]
    principalId: probeIdentity.properties.principalId
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${environmentName}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}
resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}
resource api 'Microsoft.App/containerApps@2025-07-01' = if (deployWorkloads) {
  name: apiName
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 2
      ingress: { external: true, targetPort: 4000, transport: 'http', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [{ name: 'database-url', value: databaseUrl }, { name: 'database-ca', value: databaseSslCa }]
    }
    template: {
      revisionSuffix: 'r-${take(releaseId, 12)}'
      terminationGracePeriodSeconds: 15
      containers: [{
        name: 'api'
        image: apiImage
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'HOST', value: '0.0.0.0' }
          { name: 'PORT', value: '4000' }
          { name: 'ENVIRONMENT', value: 'preproduction' }
          { name: 'RELEASE_ID', value: releaseId }
          { name: 'APP_ORIGIN', value: webOrigin }
          { name: 'ALLOWED_ORIGINS', value: webOrigin }
          { name: 'SUPABASE_JWKS_URL', value: '${authOrigin}/auth/v1/.well-known/jwks.json' }
          { name: 'SUPABASE_JWT_ISSUER', value: '${authOrigin}/auth/v1' }
          { name: 'SUPABASE_JWT_AUDIENCE', value: 'authenticated' }
          { name: 'DATABASE_URL', secretRef: 'database-url' }
          { name: 'DATABASE_SSL_CA', secretRef: 'database-ca' }
        ]
        probes: [
          { type: 'Startup', httpGet: { path: '/health/live', port: 4000, scheme: 'HTTP' }, periodSeconds: 2, timeoutSeconds: 2, failureThreshold: 30 }
          { type: 'Liveness', httpGet: { path: '/health/live', port: 4000, scheme: 'HTTP' }, periodSeconds: 15, timeoutSeconds: 3, failureThreshold: 3 }
          { type: 'Readiness', httpGet: { path: '/health/ready', port: 4000, scheme: 'HTTP' }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3 }
        ]
      }]
      scale: { minReplicas: 0, maxReplicas: 1 }
    }
  }
  dependsOn: [pullPermission]
}
resource job 'Microsoft.App/jobs@2025-07-01' = if (deployWorkloads && deployJob) {
  name: jobName
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${probeIdentity.id}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: jobTimeoutSeconds
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registry.properties.loginServer, identity: probeIdentity.id }]
      secrets: concat(
        [{ name: 'probe-manifest', value: jobManifest }],
        jobOperation == 'probe:sandbox' ? [{ name: 'vercel-token', value: vercelToken }] : [],
        jobOperation == 'probe:ai' && aiAuthMode == 'api-key' ? [{ name: 'ai-key', value: aiAzureApiKey }] : []
      )
    }
    template: {
      containers: [{
        name: 'probe'
        image: jobImage
        command: ['node', 'scripts/preprod-job.mjs']
        args: [jobOperation]
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat([{ name: 'PREPROD_MANIFEST_JSON', secretRef: 'probe-manifest' }], jobOperation == 'probe:sandbox' ? [
          { name: 'VERCEL_TOKEN', secretRef: 'vercel-token' }
          { name: 'VERCEL_TEAM_ID', value: sandboxTeamId }
          { name: 'VERCEL_PROJECT_ID', value: sandboxProjectId }
          { name: 'RUNNER_SANDBOX_IMAGE', value: sandboxImage }
          { name: 'RUNNER_SANDBOX_REGION', value: sandboxRegion }
        ] : concat([
          { name: 'AI_AUTH_MODE', value: aiAuthMode }
          { name: 'AI_EMBEDDING_MODEL', value: aiEmbeddingModel }
          { name: 'AI_GENERATION_MODEL', value: aiGenerationModel }
          { name: 'AI_CONFIGURATION_ID', value: aiConfigurationId }
        ], aiAuthMode == 'api-key' ? [{ name: 'AI_AZURE_API_KEY', secretRef: 'ai-key' }] : [
          { name: 'AI_MANAGED_IDENTITY_CLIENT_ID', value: probeIdentity.properties.clientId }
        ]))
      }]
    }
  }
  dependsOn: [probePullPermission, aiPermission]
}

output registryHost string = registry.properties.loginServer
output managedIdentityId string = identity.id
output probeManagedIdentityId string = probeIdentity.id
output environmentId string = environment.id
output apiOrigin string = deployWorkloads ? 'https://${api!.properties.configuration.ingress.fqdn}' : ''
output jobResourceId string = deployWorkloads && deployJob ? job!.id : ''
