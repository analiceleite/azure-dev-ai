require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { publishComment } = require('../tools/publish-comment');

const summary = `## Objetivo

Implementar multitenancy seguro no backend LevelUp com isolamento de dados por schema PostgreSQL por tenant, provisionamento automático ao criar tenant, e padronização de nomes de tabelas/colunas em snake_case.

## Alterações realizadas

### Multitenancy (schema por tenant)
- **SchemaName** persistido em \`Tenant\` (catálogo em \`public\`), com normalização (\`TenantSchemaNameNormalizer\`) e resolução de unicidade (\`ResolveUniqueSchemaNameAsync\` com sufixo \`_1\`, \`_2\`, …).
- **Dois DbContexts**: \`LevelUpDbContext\` (catálogo: tenants, memberships, roles) e \`AppDbContext\` (dados da app por schema: trainings, scenarios, criterion_cluster).
- **Correção de vazamento cross-tenant**: \`TenantModelCacheKeyFactory\` inclui schema na chave do cache do modelo EF.
- **TenantSchemaProvisioner**: \`CREATE SCHEMA\`, \`SET search_path\`, pré-criação de \`__EFMigrationsHistory\`, \`MigrateAsync\` por tenant; guard contra tabelas de app em \`public\`.
- Provisionamento em: criação de tenant, bootstrap, seeders, startup (tenants ativos) e middleware (lazy).
- **ExternalId** + **Type**: índice único para idempotência em integrações; \`SchemaName\` único no catálogo.

### API e DTOs
- \`CreateTenantRequest\`: \`SchemaName\` e \`ExternalId\` opcionais.
- Respostas admin e \`GET /api/tenant/current\` expõem \`schemaName\`.
- Bootstrap default: \`platform_levelup\`.

### Migrations
- \`AddTenantSchemaName\`: coluna + backfill + índice único.
- \`RenameCatalogToSnakeCase\` (LevelUp): \`tenants\`, \`user_tenant_memberships\`, \`tenant_user_roles\`.
- \`RenameTenantDataToSnakeCase\` (App): \`criterion_cluster\` + colunas snake_case em trainings/scenarios.

### Naming conventions (EFCore.NamingConventions)
- \`.UseSnakeCaseNamingConvention()\` em **ambos** os DbContexts (Program.cs + design-time factories).
- Remoção de \`ToTable\` PascalCase no \`LevelUpDbContext\` para a convenção aplicar.
- **LegacyMigrationHistoryCompat**: renomeia colunas legadas de \`__EFMigrationsHistory\` (\`MigrationId\` → \`migration_id\`) antes do migrate.

### Testes
- \`MultitenancyApiTests\` e \`IntegrationTestDataSeeder\` com \`integration_test\` como schema de teste.
- Suite de integração validada após as alterações.

## Arquivos principais impactados

- \`App.Api/Program.cs\`, \`TenantValidationMiddleware.cs\`, \`TenantController.cs\`
- \`App.Infrastructure/Persistence/AppDbContext.cs\`, \`TenantSchemaProvisioner.cs\`, \`TenantModelCacheKeyFactory.cs\`
- \`App.Infrastructure/Tenancy/*\` (LevelUpDbContext, TenantAdminService, BootstrapService, MultitenancySeeder)
- \`App.Application/Tenancy/*\` (TenantSchemaNames, TenantSchemaNameNormalizer, DTOs)
- Migrations LevelUp e App (incl. snake_case)

## Branch

\`fix/tenant\` — alterações locais e commits relacionados a tenant management + migrations.

## Observações operacionais

- Ambientes com tabelas antigas em \`public\` (trainings/scenarios): remover antes de reprovisionar schemas de tenant.
- Novas entidades com convenção ativa geram tabelas/colunas em snake_case automaticamente; gerar migration com factories que incluem \`UseSnakeCaseNamingConvention()\`.
`;

publishComment('10187', summary)
  .then((result) => {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  })
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, message: err.message }, null, 2));
    process.exit(1);
  });
