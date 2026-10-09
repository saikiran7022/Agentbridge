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

{{/* Shared env for web, worker and the migration job. */}}
{{- define "hub.env" -}}
envFrom:
  - configMapRef:
      name: {{ include "hub.fullname" . }}-config
  - secretRef:
      name: {{ include "hub.secretName" . }}
{{- with .Values.extraEnv }}
env:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "hub.waitForPostgres" -}}
{{- if .Values.postgres.enabled }}
- name: wait-for-postgres
  image: {{ .Values.postgres.image }}
  command: ["sh", "-c", "until pg_isready -h {{ include "hub.fullname" . }}-postgres -U {{ .Values.postgres.user }}; do sleep 2; done"]
{{- end }}
{{- end -}}
