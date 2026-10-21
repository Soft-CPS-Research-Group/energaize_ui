import { describe, expect, it } from 'vitest';
import { numericParams, serializeLayer } from './trainForms';

describe('Training hyperparameters', () => {
  it('sends only the fields the user filled in, as numbers', () => {
    expect(numericParams({ n_estimators: '800', max_depth: '', learning_rate: ' ', subsample: '0.7' }))
      .toEqual({ n_estimators: 800, subsample: 0.7 });
  });

  it('never turns a cleared or invalid field into 0', () => {
    expect(numericParams({ learning_rate: '', epochs: 'abc', patience: '-' })).toEqual({});
  });

  it('keeps an explicit zero or negative value', () => {
    expect(numericParams({ reg_alpha: '0', max_depth: '-1' })).toEqual({ reg_alpha: 0, max_depth: -1 });
  });

  it('falls back to the layer default when a layer field is cleared', () => {
    expect(serializeLayer({ id: 'a', type: 'linear', out: '' })).toEqual({ type: 'linear', out: 64 });
    expect(serializeLayer({ id: 'b', type: 'lstm', hidden: '32', num_layers: '' })).toEqual({ type: 'lstm', hidden: 32, num_layers: 2 });
    expect(serializeLayer({ id: 'c', type: 'dropout', p: 'x' })).toEqual({ type: 'dropout', p: 0.3 });
  });
});

describe('Training field checks', async () => {
  const { validateParams } = await import('./trainForms');
  const { formatJobTime } = await import('./TrainView');

  it('accepts empty fields and in-range values', () => {
    expect(validateParams({ n_estimators: '', subsample: '0.8', max_depth: '5' }, 'xgboost')).toEqual({});
  });

  it('flags values the trainers reject', () => {
    expect(validateParams({ n_estimators: '0', subsample: '1.5', learning_rate: '0', max_depth: '2.5' }, 'xgboost')).toEqual({
      n_estimators: 'Must be 1 or more',
      subsample: 'Must be 1 or less',
      learning_rate: 'Must be above 0',
      max_depth: 'Enter a whole number',
    });
  });

  it('allows LightGBM max_depth -1 (no limit) but not for XGBoost', () => {
    expect(validateParams({ max_depth: '-1' }, 'lgbm')).toEqual({});
    expect(validateParams({ max_depth: '-1' }, 'xgboost')).toEqual({ max_depth: 'Must be 1 or more' });
  });

  it('reads job times as UTC and shows them in the chosen timezone', () => {
    expect(formatJobTime('2026-10-20T10:00:00.123456', 'Europe/Lisbon')).toBe('20/10/2026, 11:00');
    expect(formatJobTime(null, 'UTC')).toBe('—');
  });
});
