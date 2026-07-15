import type { FoodWithBrand } from "@/lib/catalog";

export const ACANA_MFG = `
Guaranteed Analysis
Crude protein (min.) 36 %
Crude fat (min.) 18 %
Crude fiber (max.) 4 %
Moisture (max.) 10 %
EPA (eicosapentaenoic acid) (min.) 0.1 %
DHA (docosahexaenoic acid) (min.) 0.15 %
Calcium (min.) 1.9 %
Phosphorus (min.) 1.3 %
Magnesium (min.) 0.1%
Taurine (min.) 0.1%
Omega-3 fatty acids* (min.) 0.8 %
Omega-6 fatty acids* (min.) 3 %
Total Microorganisms* (min.) 1 Million CFU/lb
(Lactobacillus acidophilus Bifidobacterium animalis Lactobacillus casei)
*Not recognized as an essential nutrient by the AAFCO Cat Food Nutrient Profiles.
Contains a source of live (viable) naturally occurring microorganisms.
Duck, chicken, eggs, chicken meal, turkey meal, catfish meal, whole red lentils, whole pinto beans, chicken fat, turkey, whole green lentils, whole chickpeas, pea starch, chicken liver, quail, fish oil, duck meal, lentil fiber, chicken hearts, natural chicken flavor, duck liver, freeze-dried turkey, choline chloride,whole cranberries,whole pumpkin, collard greens, whole pears, whole apples, dried kelp, zinc proteinate, vitamin E supplement, mixed tocopherols (preservative), taurine, vitamin D3 supplement, vitamin A acetate, niacin, thiamine mononitrate, riboflavin, calcium pantothenate, pyridoxine hydrochloride, folic acid, vitamin B12 supplement, biotin, copper proteinate, DL-methionine, ascorbic acid (vitamin C), dried chicory root, turmeric, sarsaparilla root, althea root, rosehips, juniper berries, citric acid (preservative), rosemary extract, dried Lactobacillus acidophilus fermentation product, dried Bifidobacterium animalis fermentation product, dried Lactobacillus casei fermentation product.
METABOLIZABLE ENERGY: 3850 kcal/kg (439 kcal per 8 fl. oz cup), with 37% from protein, 23% from carbohydrates, and 40% from fat.
ACANA™ Highest Protein Grasslands™ Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for All Life Stages.`;

export const ACANA_KR = `
재료 : 신선한 오리고기(11%), 신선한 닭고기(11%), 신선한 통 계란(8%), 닭고기 (건조육 (7%), 칠면조고기 (건조육)(7%), 송어 (건조육)(7%), 강낭콩, 콩, 신선한 칠면조고기(6%), 오리 지방(5%), 붉은 렌틸콩, 병아리 콩, 녹색 렌틸콩, 생 메추리 고기(4%), 신선한 닭 내장육(간, 심장)(2%), 대구유 (2%), 신선한 칠면조 내장육(간, 심장)(2%), 렌틸 섬유질, 오리고기 (건조육)(1%), 오리 간(1%), 오리 연골(0.5%), 동결건조된 닭 간과 칠면조 간(0.5%), 건조된 켈프, 신선한 통 호박, 신선한 통 버터넛 스쿼시, 신선한 케일, 신선한 시금치, 신선한 순무잎, 신선한 당근, 신선한 사과, 신선한 배, 신선한 통 크랜베리, 신선한 통 블루베리, 치커리 뿌리, 강황 뿌리, 밀크 시슬, 우엉뿌리, 라벤더, 마시멜로 뿌리,로즈힙. 첨가물 (per kg) 기술적인 첨가물: 천연 항산화제. 자연적인 첨가물: 염화콜린: 1200 mg, 타우린: 400 mg, 아연 (수산화 아미노산 킬레이트 아연): 150 mg, 비타민 B1: 25 mg, 비타민 B2: 10 mg, 니아신: 50 mg, 비타민 B5: 8 mg, 비타민 B6: 7.5 mg, 엽산: 0.75 mg, 비오틴: 0.01 mg, 비타민 B12: 0.1 mg, 비타민 A: 1875 IU, 비타민 D: 250 IU, 비타민 E: 150 IU, 구리 (수산화 아미노산 킬레이트 구리): 11mg, DL-메티오닌: 99 mg.축산학적 첨가물: 엔테로코커스패슘 유산균 NCIMB10415: 60x10^6CFU.
칼로리 : 신진대사 에너지는 3930Kcal/kg (120g 당 472Kcal) 이며, 최상의 신체 상태를 위해 분포되었습니다. 칼로리의 38%는  단백질에서, 23%는 탄수화물에서, 39%는 지방에서 나옵니다.
등록성분량 : 조단백질 36.0% 이상, 조지방 18.0% 이상, 조섬유 3.0% 이하, 조회분 9.0% 이하, 칼슘 1.9% 이상, 인 1.3% 이상, 수분 10.0% 이하, 마그네슘 0.1% 이하, 타우린 0.1% 이상, 오메가-6 2.5% 이상, 오메가-3 0.8% 이상, DHA 0.2% 이상, EPA 0.2% 이상`;

export const SAMPLE_FOODS: FoodWithBrand[] = [
  {
    id: 0,
    brand_id: 0,
    product_name: "Highest Protein Grasslands Cat",
    cooking_method: "extrusion",
    protein_pct: 36,
    fat_pct: 18,
    fiber_pct: 4,
    ash_pct: 9,
    moisture_pct: 10,
    calcium_pct: 1.9,
    phosphorus_pct: 1.3,
    kcal_per_kg: 3850,
    carb_pct: 23,
    carb_is_estimated: false,
    energy_p_pct: 37,
    energy_f_pct: 40,
    energy_c_pct: 23,
    ca_p_ratio: 1.462,
    nutrient_sources: {
      protein_pct: "manufacturer",
      fat_pct: "manufacturer",
      fiber_pct: "manufacturer",
      ash_pct: "kr_label",
      moisture_pct: "manufacturer",
      calcium_pct: "manufacturer",
      phosphorus_pct: "manufacturer",
      kcal_per_kg: "manufacturer",
      energy_p_pct: "manufacturer",
      energy_f_pct: "manufacturer",
      energy_c_pct: "manufacturer",
      carb_pct: "derived",
    },
    ingredients: [
      { name: "Duck", pct: 11, type: "meat" },
      { name: "Chicken", pct: 11, type: "meat" },
      { name: "Eggs", pct: 8, type: "other" },
    ],
    grain_free: true,
    meal_free: false,
    has_probiotics: true,
    has_cranberry: true,
    has_yucca: false,
    caution_ingredients: [],
    manufacturer_url: null,
    kr_label_source: "ACANA Grasslands regression fixture",
    data_verified_at: "2026-05-31T00:00:00.000Z",
    brands: {
      id: 0,
      name: "ACANA",
      manufacturer: "Champion Petfoods",
      importer: "두원실업",
      country: "Canada",
    },
    recalls: [],
    prices: [],
  },
];
