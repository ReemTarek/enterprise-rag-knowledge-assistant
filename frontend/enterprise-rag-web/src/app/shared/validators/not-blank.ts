import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Required, ignoring surrounding whitespace: whitespace-only values are invalid (forms trim before sending). Reports
 * the standard `required` error so templates reuse their "required" message.
 */
export function notBlank(control: AbstractControl<string | null>): ValidationErrors | null {
  return (control.value ?? '').trim().length === 0 ? { required: true } : null;
}
