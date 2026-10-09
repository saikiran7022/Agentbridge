{{- define "hub.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "hub.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "hub.selector" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "hub.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "hub.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "hub.secretName" -}}
{{- default (printf "%s-env" (include "hub.fullname" .)) .Values.existingSecret -}}
{{- end -}}

{{- define "hub.databaseUrl" -}}
{{- if .Values.postgres.enabled -}}
{{- printf "postgresql://%s:%s@%s-postgres:5432/%s" .Values.postgres.user .Values.postgres.password (include "hub.fullname" .) .Values.postgres.database -}}
{{- else -}}
{{- required "externalDatabaseUrl is required when postgres.enabled=false" .Values.externalDatabaseUrl -}}
{{- end -}}
{{- end -}}

{{- define "hub.redisUrl" -}}
{{- if .Values.redis.enabled -}}
{{- printf "redis://%s-redis:6379" (include "hub.fullname" .) -}}
{{- else -}}
{{- required "externalRedisUrl is required when redis.enabled=false" .Values.externalRedisUrl -}}
{{- end -}}
{{- end -}}

{{- define "hub.oidcEnabled" -}}
{{- if or .Values.keycloak.enabled .Values.oidc.issuer -}}true{{- end -}}
{{- end -}}

{{- define "hub.oidcIssuer" -}}
{{- if .Values.keycloak.enabled -}}
{{- printf "%s/realms/%s" (trimSuffix "/" .Values.keycloak.publicUrl) .Values.keycloak.realm -}}
{{- else -}}
{{- .Values.oidc.issuer -}}
{{- end -}}
{{- end -}}

{{- define "hub.oidcInternalUrl" -}}
{{- if .Values.keycloak.enabled -}}
{{- printf "http://%s-keycloak:8080/realms/%s" (include "hub.fullname" .) .Values.keycloak.realm -}}
{{- else -}}
{{- .Values.oidc.internalUrl -}}
{{- end -}}
{{- end -}}

{{- define "hub.oidcClientId" -}}
{{- if .Values.keycloak.enabled -}}{{ .Values.keycloak.clientId }}{{- else -}}{{ .Values.oidc.clientId }}{{- end -}}
{{- end -}}

{{/* The OIDC client secret lives in <fullname>-oidc: generated once for Keycloak, or taken from values. */}}
{{- define "hub.oidcSecretName" -}}
{{- printf "%s-oidc" (include "hub.fullname" .) -}}
{{- end -}}

{{/* Shared env for web, worker and the migration job. */}}
{{- define "hub.env" -}}
envFrom:
  - configMapRef:
      name: {{ include "hub.fullname" . }}-config
  - secretRef:
      name: {{ include "hub.secretName" . }}
{{- if or .Values.extraEnv (include "hub.oidcEnabled" .) }}
env:
  {{- if include "hub.oidcEnabled" . }}
  - name: OIDC_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: {{ include "hub.oidcSecretName" . }}
        key: clientSecret
        # The migration hook runs before this Secret exists and does not need it.
        optional: true
  {{- end }}
  {{- with .Values.extraEnv }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
{{- end }}
{{- end -}}

{{/* Realm imported by Keycloak on first start. */}}
{{- define "hub.keycloakRealm" -}}
{{- $k := .Values.keycloak -}}
{{- $hub := trimSuffix "/" .Values.hubUrl -}}
{{- $secret := .clientSecret -}}
{{- $people := list -}}
{{- if $k.demoUsers -}}
{{- range $u := list (dict "name" "alice-dev" "full" "Alice Dev" "admin" true) (dict "name" "omar-devops" "full" "Omar Devops") (dict "name" "ivan-infra" "full" "Ivan Infra") (dict "name" "sara-sec" "full" "Sara Sec") -}}
{{- $people = append $people (dict "username" $u.name "email" (printf "%s@example.com" $u.name) "firstName" (index (splitList " " $u.full) 0) "lastName" (index (splitList " " $u.full) 1) "enabled" true "emailVerified" true "credentials" (list (dict "type" "password" "value" $k.demoPassword "temporary" false)) "realmRoles" (ternary (list "hub-admin") (list) (default false $u.admin))) -}}
{{- end -}}
{{- end -}}
{{- if $k.hubAdmin.username -}}
{{- $people = append $people (dict "username" $k.hubAdmin.username "email" (default (printf "%s@example.com" $k.hubAdmin.username) $k.hubAdmin.email) "firstName" "Hub" "lastName" "Admin" "enabled" true "emailVerified" true "credentials" (list (dict "type" "password" "value" $k.hubAdmin.password "temporary" false)) "realmRoles" (list "hub-admin")) -}}
{{- end -}}
{{- $client := dict
  "clientId" $k.clientId
  "name" "Agent Liaison Hub"
  "enabled" true
  "protocol" "openid-connect"
  "publicClient" false
  "secret" $secret
  "standardFlowEnabled" true
  "directAccessGrantsEnabled" false
  "serviceAccountsEnabled" false
  "rootUrl" $hub
  "redirectUris" (list (printf "%s/api/auth/callback/oidc" $hub))
  "webOrigins" (list $hub)
  "attributes" (dict "pkce.code.challenge.method" "S256" "post.logout.redirect.uris" (printf "%s/login" $hub))
  "protocolMappers" (list (dict "name" "realm roles" "protocol" "openid-connect" "protocolMapper" "oidc-usermodel-realm-role-mapper" "config" (dict "multivalued" "true" "claim.name" "roles" "jsonType.label" "String" "id.token.claim" "true" "access.token.claim" "true" "userinfo.token.claim" "true"))) -}}
{{- $realm := dict
  "realm" $k.realm
  "enabled" true
  "displayName" "Agent Liaison Hub"
  "registrationAllowed" $k.registration
  "registrationEmailAsUsername" false
  "loginWithEmailAllowed" true
  "duplicateEmailsAllowed" false
  "resetPasswordAllowed" true
  "rememberMe" true
  "verifyEmail" false
  "editUsernameAllowed" false
  "sslRequired" $k.sslRequired
  "roles" (dict "realm" (list (dict "name" "hub-admin" "description" "Organization admin in the Agent Liaison Hub")))
  "clients" (list $client)
  "users" $people -}}
{{- $realm | toPrettyJson -}}
{{- end -}}

{{- define "hub.waitForPostgres" -}}
{{- if .Values.postgres.enabled }}
- name: wait-for-postgres
  image: {{ .Values.postgres.image }}
  command: ["sh", "-c", "until pg_isready -h {{ include "hub.fullname" . }}-postgres -U {{ .Values.postgres.user }}; do sleep 2; done"]
{{- end }}
{{- end -}}
