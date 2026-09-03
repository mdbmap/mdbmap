import { graphql } from "@/generated/gql";

const TitleRatingsQuery = graphql(`
	query TitleRatings($id: ID!) {
		title(id: $id) {
			ratingsSummary {
				aggregateRating
				voteCount
			}
			metacritic {
				metascore {
					reviewCount
					score
				}
			}
		}
	}
`);

export { TitleRatingsQuery };
