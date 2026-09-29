const DAYS = ['Friday', 'Saturday', 'Sunday'];
const MAX_CLASSES = 10;

/** @typedef {{ attending: number, days: string|null, carClass: string|null, availabilityHours: string|null }} DriverResponse */

function eventClasses(event) {
  return [...new Set((event.car_class || '').split(',').map((value) => value.trim()).filter(Boolean))];
}

function selectedValues(value) {
  return [...new Set((value || '').split(',').map((part) => part.trim()).filter(Boolean))];
}

function parseDriverResponse(event, fields) {
  const availableClasses = eventClasses(event);
  const chosenClasses = [...new Set(fields.getCheckboxGroup('carClass').map((value) => value.trim()))];
  if (!chosenClasses.length || chosenClasses.some((value) => !availableClasses.includes(value))) {
    return { ok: false, error: 'Select at least one event class.' };
  }

  if (event.game === 'iracing') {
    const availabilityHours = fields.getTextInputValue('availabilityHours').trim();
    if (!availabilityHours || availabilityHours.length > 60) {
      return { ok: false, error: 'Enter your Saturday availability hours.' };
    }
    return {
      ok: true,
      response: {
        attending: 1,
        days: 'Saturday',
        carClass: chosenClasses.join(', '),
        availabilityHours,
      },
    };
  }

  const chosenDays = fields.getCheckboxGroup('days');
  if (!chosenDays.length || chosenDays.some((day) => !DAYS.includes(day))) {
    return { ok: false, error: 'Select at least one driving day.' };
  }
  return {
    ok: true,
    response: {
      attending: 1,
      days: DAYS.filter((day) => chosenDays.includes(day)).join(', '),
      carClass: chosenClasses.join(', '),
      availabilityHours: null,
    },
  };
}

module.exports = { DAYS, MAX_CLASSES, eventClasses, selectedValues, parseDriverResponse };
