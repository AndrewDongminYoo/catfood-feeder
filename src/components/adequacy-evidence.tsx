import type { AdequacyProof } from "@/lib/adequacy-evidence";

const STAGES: Record<AdequacyProof["lifeStage"], string> = {
  adult_maintenance: "성묘 유지",
  growth: "성장기",
  growth_reproduction: "성장·번식기",
  growth_maintenance: "성장기·성묘 유지",
  all_life_stages: "전연령",
  unspecified: "단계 미확인",
};
const METHODS: Record<AdequacyProof["method"], string> = {
  formulation: "영양기준에 맞춰 배합했다는 선언",
  feeding_trial: "급여시험으로 입증했다는 선언",
  product_family: "급여시험을 거친 제품과 영양적으로 동등하다는 선언",
  unspecified: "입증 방식 미확인",
};
export function AdequacyEvidence({
  proofs = [],
  unavailable = false,
  headingLevel = 4,
}: {
  proofs?: readonly AdequacyProof[];
  unavailable?: boolean;
  headingLevel?: 2 | 4;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h4";
  return (
    <section className="adequacy-evidence">
      <Heading>제조사 영양 적합성 선언</Heading>
      {unavailable ? (
        <p role="status">
          지금은 선언 자료를 불러오지 못했어요. 다른 성분 자료를 먼저 살펴보고
          잠시 후 다시 확인해 주세요.
        </p>
      ) : proofs.length ? (
        proofs.map((proof) => (
          <div key={`${proof.url}-${proof.statement}`}>
            <p>
              <strong>
                {proof.standard} · {STAGES[proof.lifeStage]}
              </strong>
            </p>
            <p>{METHODS[proof.method]}</p>
            <details>
              <summary>선언 원문과 출처 보기</summary>
              <p>출처의 제품명: {proof.sourceProductName}</p>
              <blockquote className="proof-quote">{proof.statement}</blockquote>
              <p>
                <a href={proof.url} target="_blank" rel="noreferrer">
                  제조사 원문 보기
                </a>{" "}
                · {proof.capturedAt.slice(0, 10)} 수집
              </p>
              <p>
                {proof.appliedByOrigin === "automation"
                  ? "자동 적용한 원문 근거"
                  : "관리자가 적용한 원문 근거"}{" "}
                · 기준 판본 미확인
              </p>
            </details>
          </div>
        ))
      ) : (
        <p>
          확보한 자료에서 선언을 확인하지 못했어요. 영양기준에 미달한다는 뜻은
          아닙니다.
        </p>
      )}
      {proofs.length > 0 && (
        <p className="learning-note">
          제조사의 선언을 옮긴 자료이며, 이 앱이 모든 영양소를 검증하거나 인증한
          결과는 아닙니다. 판매 지역과 현재 포장의 동일 배합 여부는 구매 전에
          확인해 주세요.
        </p>
      )}
    </section>
  );
}
