import { describe, expect, it } from 'vitest';
import { numericParams, serializeLayer } from './TrainView';

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
