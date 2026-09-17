// This part uses TypeSafe AI to categorize objects using their
// product type and brand name for context.

const repairMonitorMap = {
  // choice/option
  'bicycles': 'Bicycles',
  'clocks': 'Clocks / alarm clocks',
  'computer_phone': 'Computer equipment / phones',
  'display_sound': 'Display and sound equipment',
  'furniture': 'Furniture',
  'appliance_elec': 'Household appliances electric',
  'appliance_non_elec': 'Household appliances non-electric',
  'jewelry': 'Jewelry',
  'other': 'Other',
  'textile': 'Textile',
  'tools_elec': 'Tools electric',
  'tools_non_elec': 'Tools non-electric',
  'toys_elec': 'Toys electric',
  'toys_non_elec': 'Toys non-electric'
};

export async function getProductCategory(product, brandName) {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      state: `Object: ${product}\nBrand: ${brandName || 'Not given'}`,
      model: 'jev-latest',
      questions: {
        category: {
          type: 'choice',
          instructions: 'Which category does this object (or object and brand) best fit?',
          criteria: repairMonitorMap
        }
      }
    })
  });

  if (!response.ok) throw new Error(`TypeSafe failed: ${response.status}`);
  const result = await response.json();
  return repairMonitorMap[result.answers.category.choice];
}
