import { describe, it, expect } from 'vitest';
import type {
  Schema,
  Declaration,
  DriftReport,
  DriftSummary,
  ValidationResult,
  CompatibilityResult,
} from '../../src/registry/types.js';

describe('Registry Types', () => {
  describe('Schema', () => {
    it('should create a schema with required fields', () => {
      const schema: Schema = {
        id: 'test-schema',
        name: 'Test Schema',
        version: '1.0.0',
        compatibility: 'none',
        provider: 'test',
        declarations: [],
        watchConfig: { mode: 'manual' },
      };

      expect(schema.id).toBe('test-schema');
      expect(schema.version).toBe('1.0.0');
      expect(schema.compatibility).toBe('none');
      expect(schema.declarations).toHaveLength(0);
    });

    it('should accept all compatibility modes', () => {
      const modes = ['backward', 'forward', 'full', 'none'] as const;
      for (const mode of modes) {
        const schema: Schema = {
          id: `test-${mode}`,
          name: 'Test',
          version: '1.0.0',
          compatibility: mode,
          provider: 'test',
          declarations: [],
          watchConfig: { mode: 'manual' },
        };
        expect(schema.compatibility).toBe(mode);
      }
    });
  });

  describe('Declaration', () => {
    it('should create declarations with required fields', () => {
      const decl: Declaration = {
        kind: 'file_exists',
        target: '/path/to/file',
        severity: 'error',
      };

      expect(decl.kind).toBe('file_exists');
      expect(decl.target).toBe('/path/to/file');
      expect(decl.severity).toBe('error');
    });

    it('should accept custom kinds (extensible)', () => {
      const decl: Declaration = {
        kind: 'memory_freshness',
        target: 'memory/Observations',
        severity: 'warning',
        metadata: { maxAgeDays: 14 },
      };

      expect(decl.kind).toBe('memory_freshness');
      expect(decl.metadata?.maxAgeDays).toBe(14);
    });

    it('should accept all severity levels', () => {
      const severities = ['error', 'warning', 'info'] as const;
      for (const severity of severities) {
        const decl: Declaration = {
          kind: 'test',
          target: 'test',
          severity,
        };
        expect(decl.severity).toBe(severity);
      }
    });
  });

  describe('DriftReport', () => {
    it('should have consistent summary totals', () => {
      const results: ValidationResult[] = [
        {
          declaration: { kind: 'file_exists', target: 'a', severity: 'error' },
          valid: true,
          message: 'ok',
        },
        {
          declaration: { kind: 'file_exists', target: 'b', severity: 'error' },
          valid: false,
          message: 'missing',
        },
        {
          declaration: { kind: 'directory_exists', target: 'c', severity: 'warning' },
          valid: true,
          message: 'ok',
        },
      ];

      const drift = results.filter((r) => !r.valid);

      const summary: DriftSummary = {
        total: results.length,
        valid: results.filter((r) => r.valid).length,
        invalid: drift.length,
        byKind: {
          file_exists: { total: 2, invalid: 1 },
          directory_exists: { total: 1, invalid: 0 },
        },
        bySeverity: {
          error: { total: 2, invalid: 1 },
          warning: { total: 1, invalid: 0 },
          info: { total: 0, invalid: 0 },
        },
      };

      const report: DriftReport = {
        schemaId: 'test',
        schemaVersion: '1.0.0',
        timestamp: new Date(),
        results,
        drift,
        summary,
      };

      // Invariant: total === valid + invalid
      expect(report.summary.total).toBe(report.summary.valid + report.summary.invalid);
      // Invariant: drift length === invalid count
      expect(report.drift.length).toBe(report.summary.invalid);
      // Invariant: byKind totals sum to total
      const kindTotal = Object.values(report.summary.byKind).reduce((sum, k) => sum + k.total, 0);
      expect(kindTotal).toBe(report.summary.total);
    });
  });

  describe('CompatibilityResult', () => {
    it('should represent compatible changes', () => {
      const result: CompatibilityResult = {
        compatible: true,
        mode: 'backward',
        breakingChanges: [],
      };

      expect(result.compatible).toBe(true);
      expect(result.breakingChanges).toHaveLength(0);
    });

    it('should represent incompatible changes with details', () => {
      const result: CompatibilityResult = {
        compatible: false,
        mode: 'full',
        breakingChanges: [
          {
            type: 'declaration_removed',
            declaration: 'file_exists:/path/to/file',
            detail: 'Removing a declaration is breaking in full compatibility mode',
          },
        ],
      };

      expect(result.compatible).toBe(false);
      expect(result.breakingChanges).toHaveLength(1);
      expect(result.breakingChanges[0].type).toBe('declaration_removed');
    });
  });
});
